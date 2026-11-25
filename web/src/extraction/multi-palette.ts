import {
  colourTemperature,
  contrastRatio,
  labChroma,
  labDistance,
  labToRgb,
  lightReflectanceValue,
  normaliseRgb,
  rgbDistanceSquared,
  rgbToHexUpper,
  rgbToLab,
  type Lab,
} from '../colour/conversion';
import { getColourName } from '../colour/names';
import type {
  ColourTemperature,
  GeneratedPalette,
  ImageColourStats,
  MultiPaletteOptions,
  MultiPaletteResult,
  PaletteSwatch,
  RGB,
  WeightedColour,
} from '../types';
import { extractNatural } from './natural';
import { countColours, selectDistinctColours } from './shared';

interface RichCandidate extends RGB {
  weight: number;
  lab: Lab;
  chroma: number;
}

function toRichCandidate(colour: WeightedColour): RichCandidate {
  const norm = normaliseRgb(colour);
  const lab = rgbToLab(norm);
  return {
    ...norm,
    weight: colour.weight,
    lab,
    chroma: labChroma(lab),
  };
}

function makeSwatch(
  colour: RGB,
  role: string,
  extra: {
    proportion?: number;
    contrastWithBg?: number;
    note?: string;
  } = {},
): PaletteSwatch {
  const norm = normaliseRgb(colour);
  return {
    ...norm,
    hex: rgbToHexUpper(norm),
    name: getColourName(norm),
    role,
    proportion: extra.proportion,
    lrv: lightReflectanceValue(norm),
    temperature: colourTemperature(norm),
    contrastWithBg: extra.contrastWithBg,
    note: extra.note,
  };
}

/**
 * Quantises all pixels into 16x16x16 RGB buckets and returns both top-frequency
 * buckets and perceptually salient minority buckets (e.g. a bright dress or white
 * shirt occupying only ~1% of a large dark sky gradient).
 */
function extractQuantisedBuckets(pixels: readonly RGB[], minShare = 0.001): RichCandidate[] {
  interface Bucket {
    r: number;
    g: number;
    b: number;
    count: number;
  }

  const buckets = new Map<number, Bucket>();
  for (const pixel of pixels) {
    const key = ((pixel.r >> 4) << 8) | ((pixel.g >> 4) << 4) | (pixel.b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += pixel.r;
    bucket.g += pixel.g;
    bucket.b += pixel.b;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const minCount = Math.max(4, Math.floor(pixels.length * minShare));
  const significant: RichCandidate[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.count < minCount) continue;
    significant.push(
      toRichCandidate({
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
        weight: bucket.count,
      }),
    );
  }

  if (significant.length === 0) {
    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 24)
      .map((bucket) =>
        toRichCandidate({
          r: bucket.r / bucket.count,
          g: bucket.g / bucket.count,
          b: bucket.b / bucket.count,
          weight: bucket.count,
        }),
      );
  }

  const byWeight = [...significant].sort((a, b) => b.weight - a.weight);
  const dominant = byWeight[0];
  const topByWeight = byWeight.slice(0, 20);

  // Pick minority buckets that stand out strongly from the dominant background
  const bySaliency = [...significant]
    .sort((a, b) => {
      const distA = dominant ? labDistance(a.lab, dominant.lab) : 0;
      const distB = dominant ? labDistance(b.lab, dominant.lab) : 0;
      const scoreA = (distA + a.chroma * 0.75) * Math.log10(a.weight + 4);
      const scoreB = (distB + b.chroma * 0.75) * Math.log10(b.weight + 4);
      return scoreB - scoreA;
    })
    .slice(0, 20);

  const combined: RichCandidate[] = [...topByWeight];
  for (const item of bySaliency) {
    if (!combined.some((existing) => labDistance(existing.lab, item.lab) < 6)) {
      combined.push(item);
    }
  }
  return combined;
}

function buildRichPool(pixels: readonly RGB[]): {
  candidates: RichCandidate[];
  stats: ImageColourStats;
} {
  const natural = extractNatural(pixels, 24).map(toRichCandidate);
  const salientBuckets = extractQuantisedBuckets(pixels, 0.001);

  const pool: RichCandidate[] = [...natural];
  for (const item of salientBuckets) {
    const tooClose = pool.some((existing) => labDistance(existing.lab, item.lab) < 6);
    if (!tooClose) pool.push(item);
  }

  let totalWeight = 0;
  let sumL = 0;
  let sumChroma = 0;
  let warmWeight = 0;

  for (const c of natural) {
    totalWeight += c.weight;
    sumL += c.lab.l * c.weight;
    sumChroma += c.chroma * c.weight;
    if (colourTemperature(c) === 'Warm') warmWeight += c.weight;
  }

  const divisor = totalWeight || 1;
  return {
    candidates: pool.sort((a, b) => b.weight - a.weight),
    stats: {
      averageLightness: sumL / divisor,
      warmRatio: warmWeight / divisor,
      chromaMean: sumChroma / divisor,
    },
  };
}

/**
 * Adjusts CIE Lab lightness toward target direction until WCAG contrast against background meets minRatio.
 */
function ensureContrast(
  colour: RGB,
  background: RGB,
  minRatio: number,
  preferLighter: boolean,
): RGB {
  if (contrastRatio(colour, background) >= minRatio) return normaliseRgb(colour);

  const baseLab = rgbToLab(colour);
  let best = normaliseRgb(colour);
  let bestContrast = contrastRatio(best, background);

  for (let step = 1; step <= 40; step += 1) {
    const delta = step * 2.5;
    const nextL = preferLighter
      ? Math.min(98, baseLab.l + delta)
      : Math.max(4, baseLab.l - delta);
    const candidate = labToRgb({ l: nextL, a: baseLab.a, b: baseLab.b });
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestContrast) {
      best = candidate;
      bestContrast = ratio;
    }
    if (ratio >= minRatio) return candidate;
  }

  return best;
}

/**
 * Clamps chroma (saturation in CIE Lab) while keeping hue direction.
 */
function tuneLabColour(lab: Lab, targetL: number, maxChroma: number): RGB {
  const chroma = labChroma(lab);
  const scale = chroma > maxChroma && chroma > 0 ? maxChroma / chroma : 1;
  return labToRgb({
    l: Math.max(0, Math.min(100, targetL)),
    a: lab.a * scale,
    b: lab.b * scale,
  });
}

function buildUtamaPalette(
  pixels: readonly RGB[],
  pool: readonly RichCandidate[],
): GeneratedPalette {
  const unique = countColours(pixels);
  const targetCount = Math.min(7, unique.length);

  // Use dominant natural clusters + salient distinct buckets so large dark/purple
  // gradients do not crowd out iconic focal colours (e.g. yellow dress, white shirt).
  const dominant = extractNatural(pixels, Math.max(targetCount * 2, 16));
  const merged: WeightedColour[] = [...dominant];
  for (const item of pool) {
    if (!merged.some((existing) => labDistance(rgbToLab(existing), item.lab) < 12)) {
      merged.push({ r: item.r, g: item.g, b: item.b, weight: item.weight });
    }
  }

  // Perceptual separation >= 24 DeltaE avoids near-identical dark background shades
  // hoarding all 7 slots while still returning 7 colours via max-distance backfill.
  const selected = selectDistinctColours(merged, targetCount, 24);

  // Measure real pixel coverage per selected color
  const counts = new Array<number>(selected.length).fill(0);
  for (const colour of unique) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < selected.length; i += 1) {
      const target = selected[i];
      if (!target) continue;
      const dist = rgbDistanceSquared(colour, target);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    counts[bestIdx] = (counts[bestIdx] ?? 0) + colour.count;
  }

  const totalPixels = pixels.length || 1;
  const ranked = selected
    .map((colour, index) => ({
      colour,
      proportion: Math.round(((counts[index] ?? 0) / totalPixels) * 1000) / 10,
    }))
    .sort((a, b) => b.proportion - a.proportion);

  const swatches = ranked.map((entry, idx) =>
    makeSwatch(entry.colour, `Mayoritas #${idx + 1}`, {
      proportion: entry.proportion,
      note: `${entry.proportion.toFixed(1)}% area piksel`,
    }),
  );

  return {
    id: 'utama',
    title: 'Palet Utama (7 Warna Mayoritas)',
    subtitle: `${swatches.length} warna dominan & aksen citra`,
    description:
      'Ekstraksi 7 warna asli citra dengan pengelompokan perseptual CIE Lab agar warna latar yang luas tidak menenggelamkan objek kontras utama.',
    swatches,
    meta: {
      ratioRule: 'Proporsi piksel asli',
    },
  };
}

function buildWebPalette(
  candidates: readonly RichCandidate[],
  stats: ImageColourStats,
  preference: 'auto' | 'light' | 'dark',
): GeneratedPalette {
  const mode: 'light' | 'dark' = preference === 'auto'
    ? (stats.averageLightness < 42 ? 'dark' : 'light')
    : preference;
  const isDark = mode === 'dark';

  const anchor = candidates[0] ?? toRichCandidate({ r: 120, g: 120, b: 120, weight: 1 });

  // 1. Background: neutral, ultra-light (light mode) or ultra-dark (dark mode)
  const rawBg = candidates.find((c) =>
    c.chroma <= 18 && (isDark ? c.lab.l <= 18 : c.lab.l >= 88),
  );
  const bgRgb = rawBg
    ? tuneLabColour(rawBg.lab, isDark ? Math.min(16, Math.max(7, rawBg.lab.l)) : Math.max(93, Math.min(98, rawBg.lab.l)), 8)
    : tuneLabColour(anchor.lab, isDark ? 11 : 96.5, 5);

  // 2. Surface: subtle elevation step from Background
  const bgLab = rgbToLab(bgRgb);
  const surfaceRgb = tuneLabColour(bgLab, isDark ? bgLab.l + 6 : bgLab.l - 4.5, 9);

  // 3. Primary: highest saliency (chroma * log weight), tuned for >= 4.5:1 contrast on Background
  const scoredExpressive = [...candidates]
    .map((c) => ({
      candidate: c,
      score: ((c.chroma + 6) ** 1.35) * Math.log10(c.weight + 10),
    }))
    .sort((a, b) => b.score - a.score);

  const primaryPick = scoredExpressive[0]?.candidate ?? anchor;
  const primaryBase = primaryPick.chroma < 12
    ? labToRgb({ l: isDark ? 68 : 44, a: primaryPick.lab.a * 1.4, b: primaryPick.lab.b * 1.4 })
    : primaryPick;
  const primaryRgb = ensureContrast(primaryBase, bgRgb, 4.5, isDark);

  // 4. Accent / Secondary: distinct from Primary (DeltaE >= 26) and legible (>= 3.0:1)
  const primaryLab = rgbToLab(primaryRgb);
  const accentPick =
    scoredExpressive.find(({ candidate }) =>
      labDistance(candidate.lab, primaryLab) >= 26 && labDistance(candidate.lab, bgLab) >= 22,
    )?.candidate
    ?? scoredExpressive.find(({ candidate }) => labDistance(candidate.lab, primaryLab) >= 14)?.candidate
    ?? candidates[1]
    ?? primaryPick;
  const accentRgb = ensureContrast(accentPick, bgRgb, 3.0, isDark);

  // 5. Text: high-contrast foreground (>= 7.0:1 AAA target, minimum 4.5:1 AA)
  const rawText = [...candidates]
    .filter((c) => c.chroma <= 18 && (isDark ? c.lab.l >= 78 : c.lab.l <= 26))
    .sort((a, b) => (isDark ? b.lab.l - a.lab.l : a.lab.l - b.lab.l))[0];
  const textSeed = rawText
    ? tuneLabColour(rawText.lab, isDark ? Math.max(90, rawText.lab.l) : Math.min(18, rawText.lab.l), 8)
    : tuneLabColour(anchor.lab, isDark ? 93 : 13, 6);
  const textRgb = ensureContrast(textSeed, bgRgb, 7.0, isDark);

  const textContrast = Math.round(contrastRatio(textRgb, bgRgb) * 10) / 10;
  const primaryContrast = Math.round(contrastRatio(primaryRgb, bgRgb) * 10) / 10;
  const accentContrast = Math.round(contrastRatio(accentRgb, bgRgb) * 10) / 10;

  const swatches: PaletteSwatch[] = [
    makeSwatch(bgRgb, 'Background', { note: 'Latar utama halaman (60%)' }),
    makeSwatch(surfaceRgb, 'Surface / Card', {
      contrastWithBg: Math.round(contrastRatio(surfaceRgb, bgRgb) * 10) / 10,
      note: 'Panel, kartu & navbar',
    }),
    makeSwatch(primaryRgb, 'Primary', {
      contrastWithBg: primaryContrast,
      note: `Kontras ${primaryContrast}:1 vs Bg`,
    }),
    makeSwatch(accentRgb, 'Accent', {
      contrastWithBg: accentContrast,
      note: `Kontras ${accentContrast}:1 vs Bg`,
    }),
    makeSwatch(textRgb, 'Text', {
      contrastWithBg: textContrast,
      note: `WCAG ${textContrast >= 7 ? 'AAA' : 'AA'} (${textContrast}:1)`,
    }),
  ];

  return {
    id: 'web',
    title: 'Palet Web Design (UI System)',
    subtitle: `${isDark ? 'Dark' : 'Light'} UI · WCAG Contrast Verified`,
    description:
      'Dioptimalkan untuk antarmuka web: memisahkan warna latar netral, mengangkat warna aksen ber-chroma tinggi sebagai CTA, dan menjamin rasio kontras teks.',
    swatches,
    meta: {
      themeMode: mode,
      wcagSummary: `Text/Bg ${textContrast}:1 · Primary/Bg ${primaryContrast}:1`,
    },
  };
}

function buildArsitekturPalette(
  candidates: readonly RichCandidate[],
  stats: ImageColourStats,
): GeneratedPalette {
  const dominant = candidates[0] ?? toRichCandidate({ r: 210, g: 204, b: 196, weight: 1 });
  const dominantTemp: ColourTemperature = stats.warmRatio >= 0.45 ? 'Warm' : 'Cool';

  // 1. Dominant Wall (60%): comfortable LRV (L* 58..85) and muted chroma (<= 18)
  const wallCandidate = candidates.find(
    (c) => c.lab.l >= 56 && c.lab.l <= 86 && c.chroma <= 20,
  );
  const wallRgb = wallCandidate
    ? tuneLabColour(wallCandidate.lab, wallCandidate.lab.l, 18)
    : tuneLabColour(
      dominant.lab,
      Math.max(62, Math.min(82, dominant.lab.l < 40 ? 74 : dominant.lab.l)),
      14,
    );
  const wallLab = rgbToLab(wallRgb);

  // 2. Secondary Material / Furniture (30%): mid lightness (L* 28..62), natural material chroma (<= 36)
  const secondaryCandidate = candidates.find(
    (c) =>
      c.lab.l >= 26 &&
      c.lab.l <= 62 &&
      c.chroma <= 40 &&
      labDistance(c.lab, wallLab) >= 16,
  ) ?? candidates.find((c) => labDistance(c.lab, wallLab) >= 18) ?? dominant;
  const secondaryRgb = tuneLabColour(
    secondaryCandidate.lab,
    Math.max(28, Math.min(60, secondaryCandidate.lab.l)),
    34,
  );
  const secondaryLab = rgbToLab(secondaryRgb);

  // 3. Decor Accent (10%): expressive focal point separated from Wall & Secondary
  // Weight perceptual contrast against Wall & Secondary alongside Chroma so a
  // smaller complementary focal object (e.g. yellow dress) beats background shades.
  const accentCandidate = [...candidates]
    .filter(
      (c) =>
        labDistance(c.lab, wallLab) >= 24 &&
        labDistance(c.lab, secondaryLab) >= 20,
    )
    .sort((a, b) => {
      const distA = Math.min(labDistance(a.lab, wallLab), labDistance(a.lab, secondaryLab));
      const distB = Math.min(labDistance(b.lab, wallLab), labDistance(b.lab, secondaryLab));
      const scoreA = (a.chroma * 1.1 + distA * 0.85) * Math.sqrt(Math.log10(a.weight + 8));
      const scoreB = (b.chroma * 1.1 + distB * 0.85) * Math.sqrt(Math.log10(b.weight + 8));
      return scoreB - scoreA;
    })[0] ?? candidates[candidates.length - 1] ?? dominant;
  const accentRgb = normaliseRgb(accentCandidate);

  // 4. Trim & Ceiling: crisp light architectural neutral tinted by room temperature
  const trimCandidate = candidates.find((c) => c.lab.l >= 87 && c.chroma <= 9);
  const trimRgb = trimCandidate
    ? normaliseRgb(trimCandidate)
    : labToRgb({
      l: 93.5,
      a: dominantTemp === 'Warm' ? 1.2 : -1.0,
      b: dominantTemp === 'Warm' ? 4.2 : -2.6,
    });

  // 5. Fixture & Hardware: grounding dark material (charcoal, bronze, dark timber)
  const hardwareCandidate = [...candidates]
    .filter((c) => c.lab.l >= 12 && c.lab.l <= 30 && c.chroma <= 18)
    .sort((a, b) => b.weight - a.weight)[0];
  const hardwareRgb = hardwareCandidate
    ? normaliseRgb(hardwareCandidate)
    : tuneLabColour(secondaryLab, 21, 10);

  const swatches: PaletteSwatch[] = [
    makeSwatch(wallRgb, 'Dominant Wall · 60%', {
      proportion: 60,
      note: `LRV ${lightReflectanceValue(wallRgb)}% · ${colourTemperature(wallRgb)}`,
    }),
    makeSwatch(secondaryRgb, 'Furniture / Material · 30%', {
      proportion: 30,
      note: `LRV ${lightReflectanceValue(secondaryRgb)}% · ${colourTemperature(secondaryRgb)}`,
    }),
    makeSwatch(accentRgb, 'Decor Accent · 10%', {
      proportion: 10,
      note: `LRV ${lightReflectanceValue(accentRgb)}% · ${colourTemperature(accentRgb)}`,
    }),
    makeSwatch(trimRgb, 'Trim & Ceiling', {
      note: `LRV ${lightReflectanceValue(trimRgb)}% · Bidang plafon/lis`,
    }),
    makeSwatch(hardwareRgb, 'Fixture & Hardware', {
      note: `LRV ${lightReflectanceValue(hardwareRgb)}% · Kusen & aksen gelap`,
    }),
  ];

  return {
    id: 'arsitektur',
    title: 'Palet Arsitektur & Dekorasi Ruang',
    subtitle: `Aturan 60–30–10 · Dominan ${dominantTemp}`,
    description:
      'Meredam saturasi berlebih pada bidang luas dinding (LRV nyaman), memisahkan material furnitur 30%, dan menempatkan aksen dekorasi 10%.',
    swatches,
    meta: {
      ratioRule: '60% Dinding · 30% Furnitur · 10% Aksen',
      dominantTemp,
    },
  };
}

export function extractMultiPalettes(
  pixels: readonly RGB[],
  options: MultiPaletteOptions,
): MultiPaletteResult {
  if (pixels.length === 0 || options.categories.length === 0) {
    return {
      palettes: [],
      imageStats: { averageLightness: 50, warmRatio: 0.5, chromaMean: 0 },
    };
  }

  const { candidates, stats } = buildRichPool(pixels);
  const palettes: GeneratedPalette[] = [];

  for (const category of options.categories) {
    switch (category) {
      case 'utama':
        palettes.push(buildUtamaPalette(pixels, candidates));
        break;
      case 'web':
        palettes.push(buildWebPalette(candidates, stats, options.webTheme));
        break;
      case 'arsitektur':
        palettes.push(buildArsitekturPalette(candidates, stats));
        break;
    }
  }

  return { palettes, imageStats: stats };
}
