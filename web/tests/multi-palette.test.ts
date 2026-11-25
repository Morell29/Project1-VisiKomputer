import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  labToRgb,
  rgbToHexUpper,
  rgbToLab,
} from '../src/colour/conversion';
import { extractMultiPalettes } from '../src/extraction/multi-palette';
import { formatMultiPalette } from '../src/output/formatters';
import type { RGB } from '../src/types';

function repeated(colour: RGB, count: number): RGB[] {
  return Array.from({ length: count }, () => ({ ...colour }));
}

// Simulated dark cyberpunk / film screenshot: deep navy, charcoal shadows, neon cyan, hot magenta, warm amber skin, steel blue, muted teal
const filmFramePixels: RGB[] = [
  ...repeated({ r: 14, g: 22, b: 38 }, 320),
  ...repeated({ r: 28, g: 34, b: 48 }, 240),
  ...repeated({ r: 42, g: 64, b: 84 }, 180),
  ...repeated({ r: 185, g: 120, b: 85 }, 110),
  ...repeated({ r: 0, g: 218, b: 230 }, 75),
  ...repeated({ r: 240, g: 38, b: 140 }, 45),
  ...repeated({ r: 95, g: 105, b: 120 }, 90),
  ...repeated({ r: 16, g: 92, b: 104 }, 130),
];

// Simulated midtone forest/nature photo with no pure white or pure black
const midtoneForestPixels: RGB[] = [
  ...repeated({ r: 58, g: 88, b: 54 }, 260),
  ...repeated({ r: 84, g: 112, b: 68 }, 210),
  ...repeated({ r: 118, g: 96, b: 72 }, 160),
  ...repeated({ r: 72, g: 94, b: 78 }, 140),
  ...repeated({ r: 142, g: 132, b: 96 }, 90),
  ...repeated({ r: 196, g: 92, b: 52 }, 40),
  ...repeated({ r: 46, g: 64, b: 44 }, 110),
];

describe('perceptual colour & contrast utilities', () => {
  it('computes WCAG 21:1 contrast between #FFFFFF and #000000', () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1);
  });

  it('round-trips sRGB -> CIE Lab -> sRGB closely', () => {
    const sample = { r: 184, g: 92, b: 64 };
    const converted = labToRgb(rgbToLab(sample));
    expect(Math.abs(converted.r - sample.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(converted.g - sample.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(converted.b - sample.b)).toBeLessThanOrEqual(2);
  });

  it('formats uppercase 6-digit hex codes from #000000 to #FFFFFF', () => {
    expect(rgbToHexUpper({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHexUpper({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
  });
});

describe('multi-palette extraction (Utama, Web Design, Arsitektur)', () => {
  it('extracts 7 majority colours in Utama sorted by pixel share', () => {
    const result = extractMultiPalettes(filmFramePixels, {
      categories: ['utama'],
      webTheme: 'auto',
    });

    const utama = result.palettes[0];
    expect(utama?.id).toBe('utama');
    expect(utama?.swatches).toHaveLength(7);

    const proportions = utama!.swatches.map((s) => s.proportion ?? 0);
    for (let i = 1; i < proportions.length; i += 1) {
      expect(proportions[i - 1]!).toBeGreaterThanOrEqual(proportions[i]!);
    }
    for (const swatch of utama!.swatches) {
      expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/u);
    }
  });

  it('includes small salient yellow & white subjects even on a 96% purple night-sky scene (La La Land case)', () => {
    const laLaLandPixels: RGB[] = [
      ...repeated({ r: 10, g: 5, b: 54 }, 2500),
      ...repeated({ r: 22, g: 12, b: 78 }, 2200),
      ...repeated({ r: 38, g: 20, b: 112 }, 1800),
      ...repeated({ r: 52, g: 28, b: 136 }, 1400),
      ...repeated({ r: 16, g: 24, b: 64 }, 1100),
      ...repeated({ r: 24, g: 48, b: 86 }, 600),
      // Small yellow dress (~2.2% of pixels) & crisp white shirt (~1.2% of pixels)
      ...repeated({ r: 230, g: 196, b: 28 }, 220),
      ...repeated({ r: 232, g: 235, b: 240 }, 120),
    ];

    const result = extractMultiPalettes(laLaLandPixels, {
      categories: ['utama', 'web', 'arsitektur'],
      webTheme: 'auto',
    });

    const utama = result.palettes[0]!;
    expect(utama.swatches).toHaveLength(7);

    const hasYellow = utama.swatches.some((s) => s.r > 180 && s.g > 150 && s.b < 90);
    const hasLightWhite = utama.swatches.some((s) => s.r > 200 && s.g > 200 && s.b > 200);
    expect(hasYellow).toBe(true);
    expect(hasLightWhite).toBe(true);

    const archAccent = result.palettes[2]!.swatches[2]!;
    expect(archAccent.r).toBeGreaterThan(180);
    expect(archAccent.g).toBeGreaterThan(150);
  });

  it('synthesizes WCAG-accessible Web Design palettes even from midtone images', () => {
    const result = extractMultiPalettes(midtoneForestPixels, {
      categories: ['web'],
      webTheme: 'light',
    });

    const web = result.palettes[0]!;
    expect(web.id).toBe('web');
    expect(web.swatches.map((s) => s.role)).toEqual([
      'Background',
      'Surface / Card',
      'Primary',
      'Accent',
      'Text',
    ]);

    const bg = web.swatches[0]!;
    const primary = web.swatches[2]!;
    const text = web.swatches[4]!;

    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primary, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('builds a 60-30-10 Arsitektur palette with moderated wall LRV', () => {
    const result = extractMultiPalettes(filmFramePixels, {
      categories: ['arsitektur'],
      webTheme: 'auto',
    });

    const arch = result.palettes[0]!;
    expect(arch.id).toBe('arsitektur');
    expect(arch.swatches.map((s) => s.role)).toEqual([
      'Dominant Wall · 60%',
      'Furniture / Material · 30%',
      'Decor Accent · 10%',
      'Trim & Ceiling',
      'Fixture & Hardware',
    ]);

    // Dominant wall should never be pitch-black even for a dark film screenshot
    const wall = arch.swatches[0]!;
    expect(wall.lrv).toBeGreaterThan(20);
  });

  it('produces genuinely distinct palettes across Utama, Web Design, and Arsitektur', () => {
    const result = extractMultiPalettes(filmFramePixels, {
      categories: ['utama', 'web', 'arsitektur'],
      webTheme: 'light',
    });

    expect(result.palettes).toHaveLength(3);
    const utamaHexes = result.palettes[0]!.swatches.map((s) => s.hex);
    const webHexes = result.palettes[1]!.swatches.map((s) => s.hex);
    const archHexes = result.palettes[2]!.swatches.map((s) => s.hex);

    expect(webHexes).not.toEqual(utamaHexes.slice(0, 5));
    expect(archHexes).not.toEqual(utamaHexes.slice(0, 5));
    expect(webHexes).not.toEqual(archHexes);
  });

  it('exports valid JSON, CSS, and TXT for multi-palette output', () => {
    const result = extractMultiPalettes(filmFramePixels, {
      categories: ['utama', 'web', 'arsitektur'],
      webTheme: 'auto',
    });

    const json = JSON.parse(formatMultiPalette(result.palettes, 'json')) as Array<Record<string, unknown>>;
    expect(json).toHaveLength(3);

    const css = formatMultiPalette(result.palettes, 'css');
    expect(css).toContain('--web-background:');
    expect(css).toContain('--arsitektur-dominant-wall-60:');

    const txt = formatMultiPalette(result.palettes, 'txt');
    expect(txt).toContain('Palet Utama');
    expect(txt).toContain('Palet Web Design');
    expect(txt).toContain('Palet Arsitektur');
  });
});
