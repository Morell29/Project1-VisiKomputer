import './styles.css';
import type { ExtractionResponse } from './extraction/extraction.worker';
import { createSampleImage, loadImage, loadImageFromUrl, type LoadedImage } from './image/load-image';
import { formatMultiPalette, type MultiExportFormat } from './output/formatters';
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from './theme';
import {
  PALETTE_CATEGORIES,
  type GeneratedPalette,
  type ImageColourStats,
  type PaletteCategory,
  type PaletteSwatch,
  type WebThemePreference,
} from './types';

interface AppState {
  image: LoadedImage | null;
  palettes: GeneratedPalette[];
  imageStats: ImageColourStats | null;
  categories: PaletteCategory[];
  webTheme: WebThemePreference;
  exportFormat: MultiExportFormat;
  codeOpen: boolean;
  busy: boolean;
  error: string;
  notice: string;
  requestId: number;
  theme: ThemePreference;
  imageUrl: string;
}

type ImageSource = File | 'sample' | { url: string };

const appElement = document.querySelector<HTMLDivElement>('#app');
if (!appElement) throw new Error('Application root was not found.');
const app: HTMLDivElement = appElement;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function savedTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: ThemePreference): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const themeColour = document.querySelector<HTMLMetaElement>('#theme-colour');
  if (themeColour) themeColour.content = resolveTheme(theme, systemTheme.matches) === 'dark' ? '#181614' : '#f4f1eb';
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme still applies when browser storage is unavailable.
  }
}

const state: AppState = {
  image: null,
  palettes: [],
  imageStats: null,
  categories: ['utama', 'web', 'arsitektur'],
  webTheme: 'auto',
  exportFormat: 'css',
  codeOpen: false,
  busy: false,
  error: '',
  notice: '',
  requestId: 0,
  theme: savedTheme(),
  imageUrl: '',
};

applyTheme(state.theme);
systemTheme.addEventListener('change', () => {
  if (state.theme === 'system') applyTheme('system');
});

const worker = new Worker(new URL('./extraction/extraction.worker.ts', import.meta.url), { type: 'module' });
worker.addEventListener('message', ({ data }: MessageEvent<ExtractionResponse>) => {
  if (data.id !== state.requestId) return;
  state.busy = false;
  state.error = data.error ?? '';
  state.palettes = data.result.palettes;
  state.imageStats = data.result.imageStats;
  render();
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function isDarkInk(swatch: PaletteSwatch): boolean {
  return swatch.r * 0.299 + swatch.g * 0.587 + swatch.b * 0.114 < 145;
}

function swatchCardMarkup(swatch: PaletteSwatch, index: number): string {
  const dark = isDarkInk(swatch);
  const rgbText = `rgb(${swatch.r}, ${swatch.g}, ${swatch.b})`;
  return `
    <button
      class="swatch"
      type="button"
      role="listitem"
      data-copy="${swatch.hex}"
      style="--swatch:${swatch.hex};--swatch-ink:${dark ? '#fffdf8' : '#24211f'}"
      aria-label="Salin ${escapeHtml(swatch.role)} ${swatch.hex}"
      title="${escapeHtml(swatch.role)} · ${swatch.hex} · ${rgbText}"
    >
      <div class="swatch-top">
        <span class="swatch-role">${escapeHtml(swatch.role)}</span>
        <span class="swatch-index">${String(index + 1).padStart(2, '0')}</span>
      </div>
      <div class="swatch-bottom">
        <strong>${swatch.hex}</strong>
        <small class="swatch-rgb">${rgbText}</small>
        <small class="swatch-meta">${escapeHtml(swatch.note ?? swatch.name)}</small>
      </div>
    </button>
  `;
}

function webPreviewMarkup(palette: GeneratedPalette): string {
  const [bg, surface, primary, accent, text] = palette.swatches;
  if (!bg || !surface || !primary || !accent || !text) return '';
  const primaryInk = isDarkInk(primary) ? '#FFFFFF' : '#181614';
  const accentInk = isDarkInk(accent) ? '#FFFFFF' : '#181614';
  return `
    <div
      class="domain-preview web-preview"
      style="background:${bg.hex};color:${text.hex};border-color:${surface.hex}"
      aria-label="Pratinjau UI Web Design"
    >
      <div class="web-preview-nav" style="border-color:${surface.hex}">
        <span class="web-preview-brand">
          <i style="background:${primary.hex}"></i>
          <strong>Preview UI</strong>
        </span>
        <span class="web-preview-pill" style="background:${accent.hex};color:${accentInk}">Accent</span>
      </div>
      <div class="web-preview-card" style="background:${surface.hex};color:${text.hex}">
        <div class="web-preview-text">
          <p class="web-preview-title">Kontras Teks &amp; Komponen</p>
          <p class="web-preview-copy">Latar ${bg.hex} · Surface ${surface.hex} · Teks ${text.hex}</p>
        </div>
        <div class="web-preview-actions">
          <span class="web-preview-btn" style="background:${primary.hex};color:${primaryInk}">Primary CTA</span>
          <span class="web-preview-link" style="color:${primary.hex}">Link teks</span>
        </div>
      </div>
    </div>
  `;
}

function arsitekturPreviewMarkup(palette: GeneratedPalette): string {
  const [wall, secondary, accent, trim, hardware] = palette.swatches;
  if (!wall || !secondary || !accent) return '';
  return `
    <div class="domain-preview arch-preview" aria-label="Pratinjau proporsi ruang 60-30-10">
      <div class="arch-ratio-bar">
        <div style="width:60%;background:${wall.hex};color:${isDarkInk(wall) ? '#fff' : '#24211f'}">
          <span>60% Dinding</span>
        </div>
        <div style="width:30%;background:${secondary.hex};color:${isDarkInk(secondary) ? '#fff' : '#24211f'}">
          <span>30% Furnitur</span>
        </div>
        <div style="width:10%;background:${accent.hex};color:${isDarkInk(accent) ? '#fff' : '#24211f'}">
          <span>10%</span>
        </div>
      </div>
      <div class="arch-extras">
        ${trim ? `<span class="arch-chip"><i style="background:${trim.hex}"></i>Trim ${trim.hex}</span>` : ''}
        ${hardware ? `<span class="arch-chip"><i style="background:${hardware.hex}"></i>Fixture ${hardware.hex}</span>` : ''}
      </div>
    </div>
  `;
}

function utamaPreviewMarkup(palette: GeneratedPalette): string {
  const total = palette.swatches.reduce((acc, s) => acc + (s.proportion ?? 0), 0) || 100;
  return `
    <div class="domain-preview utama-preview" aria-label="Distribusi proporsi 7 warna mayoritas">
      <div class="utama-ratio-bar">
        ${palette.swatches.map((s) => {
          const width = ((s.proportion ?? (100 / palette.swatches.length)) / total) * 100;
          return `<span title="${escapeHtml(s.role)}: ${s.hex} (${(s.proportion ?? 0).toFixed(1)}%)" style="width:${width.toFixed(2)}%;background:${s.hex}"></span>`;
        }).join('')}
      </div>
    </div>
  `;
}

function paletteSectionMarkup(palette: GeneratedPalette): string {
  let domainPreview = '';
  if (palette.id === 'utama') domainPreview = utamaPreviewMarkup(palette);
  else if (palette.id === 'web') domainPreview = webPreviewMarkup(palette);
  else if (palette.id === 'arsitektur') domainPreview = arsitekturPreviewMarkup(palette);

  return `
    <article class="palette-card" aria-labelledby="heading-${palette.id}">
      <div class="palette-card-header">
        <div class="palette-card-title-row">
          <h3 id="heading-${palette.id}">${escapeHtml(palette.title)}</h3>
          <span class="palette-subtitle">${escapeHtml(palette.subtitle)}</span>
        </div>
        <p class="palette-desc">${escapeHtml(palette.description)}</p>
      </div>
      ${domainPreview}
      <div class="swatches swatches-${palette.id}" role="list" aria-label="${escapeHtml(palette.title)}">
        ${palette.swatches.map((swatch, index) => swatchCardMarkup(swatch, index)).join('')}
      </div>
    </article>
  `;
}

function paletteMarkup(): string {
  if (state.busy && state.palettes.length === 0) {
    return `<section class="results-panel result-placeholder" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>Menganalisis piksel &amp; menyusun multi-palet…</p></section>`;
  }
  if (state.palettes.length === 0) {
    return `
      <section class="results-panel empty-results" aria-label="Hasil palet warna">
        <div class="empty-palette-art" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div>
          <p class="eyebrow">Multi-Palette Output</p>
          <h2>Palet akan muncul di sini</h2>
          <p>Unggah gambar (screenshot film, foto arsitektur, desain, dll.) untuk menghasilkan palet Utama, Web Design, dan Arsitektur secara bersamaan.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="results results-panel" aria-labelledby="palette-heading">
      <div class="section-heading palette-heading">
        <div>
          <p class="eyebrow">Hasil Ekstraksi Multi-Palet</p>
          <h2 id="palette-heading">${state.palettes.length} profil palet siap digunakan</h2>
        </div>
        <span class="hex-range-badge">HEX #000000 – #FFFFFF</span>
      </div>

      <div class="palette-stack">
        ${state.palettes.map(paletteSectionMarkup).join('')}
      </div>
    </section>
  `;
}

function exportMarkup(): string {
  if (state.palettes.length === 0) return '';
  const exportText = formatMultiPalette(state.palettes, state.exportFormat);
  return `
    <section class="workspace-export" aria-label="Ekspor kode palet">
      <details class="code-disclosure"${state.codeOpen ? ' open' : ''}>
        <summary>
          <span><strong>Ekspor Semua Palet</strong><small>${state.exportFormat.toUpperCase()} · Klik swatch di atas untuk salin HEX satuan</small></span>
          <span class="disclosure-action">Buka</span>
        </summary>
        <div class="code-panel">
          <div class="code-toolbar">
            <label for="output-format">Format ekspor</label>
            <select id="output-format">
              <option value="css"${state.exportFormat === 'css' ? ' selected' : ''}>CSS Variables (Semantik)</option>
              <option value="json"${state.exportFormat === 'json' ? ' selected' : ''}>JSON Lengkap</option>
              <option value="txt"${state.exportFormat === 'txt' ? ' selected' : ''}>Teks (.txt)</option>
            </select>
            <button class="button button-small" id="copy-code" type="button">Salin Semua</button>
            <button class="icon-button" id="download-code" type="button" aria-label="Unduh spesifikasi palet" title="Unduh file palet">↓</button>
          </div>
          <pre tabindex="0"><code>${escapeHtml(exportText)}</code></pre>
        </div>
      </details>
    </section>
  `;
}

function uploadMarkup(compact = false): string {
  return `
    <div class="upload-zone${compact ? ' upload-zone-compact' : ''}" id="drop-zone">
      <input class="visually-hidden" id="image-input" type="file" accept="image/*" />
      <div class="upload-icon" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <h2>${compact ? 'Ganti gambar lain' : 'Tarik & lepas gambar di sini'}</h2>
        <p>atau tempel gambar langsung dari clipboard (Ctrl+V)</p>
      </div>
      <div class="upload-actions">
        <label class="button" for="image-input">Pilih Gambar</label>
        <button class="text-button" id="sample-image" type="button">Coba gambar contoh</button>
      </div>
      <details class="url-upload"${state.error && state.imageUrl ? ' open' : ''}>
        <summary>Gunakan tautan (URL) gambar</summary>
        <form id="image-url-form">
          <label class="visually-hidden" for="image-url">Tautan gambar langsung</label>
          <input id="image-url" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com/image.jpg" value="${escapeHtml(state.imageUrl)}" required />
          <button class="button button-small" type="submit">Muat</button>
        </form>
        <small>Berfungsi jika server gambar mengizinkan akses CORS browser.</small>
      </details>
      <small>Mendukung PNG, JPEG, WebP, GIF, dan format gambar browser lainnya</small>
    </div>
  `;
}

function imageStatsMarkup(): string {
  if (!state.imageStats) return '';
  const { averageLightness, warmRatio, chromaMean } = state.imageStats;
  const toneLabel = averageLightness < 38 ? 'Gelap (Low-key)' : averageLightness > 68 ? 'Terang (High-key)' : 'Seimbang (Mid-key)';
  const warmPct = Math.round(warmRatio * 100);
  return `
    <div class="image-stats" aria-label="Analisis fitur citra">
      <span><strong>Tone:</strong> ${toneLabel} (L* ${Math.round(averageLightness)})</span>
      <span><strong>Suhu:</strong> ${warmPct}% Warm / ${100 - warmPct}% Cool</span>
      <span><strong>Chroma:</strong> ${Math.round(chromaMean)}</span>
    </div>
  `;
}

function sourceMarkup(): string {
  const categorySelector = `
    <div class="category-selector" role="group" aria-label="Pilih palet yang ingin dihasilkan">
      <div class="category-header">
        <span class="control-label">Profil Palet yang Dihasilkan</span>
        ${state.categories.includes('web') ? `
          <label class="web-theme-inline" for="web-theme-select">
            <span>Mode Web:</span>
            <select id="web-theme-select">
              <option value="auto"${state.webTheme === 'auto' ? ' selected' : ''}>Auto (sesuai gambar)</option>
              <option value="light"${state.webTheme === 'light' ? ' selected' : ''}>Light UI</option>
              <option value="dark"${state.webTheme === 'dark' ? ' selected' : ''}>Dark UI</option>
            </select>
          </label>
        ` : ''}
      </div>
      <div class="category-pills">
        ${PALETTE_CATEGORIES.map((cat) => {
          const active = state.categories.includes(cat.id);
          return `
            <button
              type="button"
              class="category-pill${active ? ' is-active' : ''}"
              data-category="${cat.id}"
              aria-pressed="${active}"
              title="${escapeHtml(cat.description)}"
            >
              <span class="pill-check" aria-hidden="true">${active ? '✓' : '+'}</span>
              <span>${escapeHtml(cat.label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  if (!state.image) {
    return `<section class="source-panel">${uploadMarkup(false)}${categorySelector}</section>`;
  }

  return `
    <section class="source-panel" aria-label="Gambar sumber dan pengaturan palet">
      <div class="preview-panel">
        <div class="image-frame"><img src="${state.image.previewUrl}" alt="Pratinjau ${escapeHtml(state.image.name)}" /></div>
        <div class="image-meta">
          <div>
            <strong>${escapeHtml(state.image.name)}</strong>
            <small>${state.image.width} × ${state.image.height} px (resampled untuk ekstraksi)</small>
          </div>
          <label class="text-button" for="image-input">Ganti</label>
          <button class="text-button" id="remove-image" type="button">Reset</button>
          <input class="visually-hidden" id="image-input" type="file" accept="image/*" />
        </div>
        ${imageStatsMarkup()}
      </div>
      ${categorySelector}
    </section>
  `;
}

function render(): void {
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="./" aria-label="Beranda Ekstraktor Palet Warna">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>Multi-Palette Extractor</span>
      </a>
      <div class="header-actions">
        <label class="theme-control" for="theme-select"><span>Tema</span><select id="theme-select" aria-label="Tema tampilan">
          <option value="system"${state.theme === 'system' ? ' selected' : ''}>System</option>
          <option value="light"${state.theme === 'light' ? ' selected' : ''}>Light</option>
          <option value="dark"${state.theme === 'dark' ? ' selected' : ''}>Dark</option>
        </select></label>
        <button class="info-button" id="open-info" type="button"><span aria-hidden="true">i</span><strong>Cara Kerja Visi Komputer</strong></button>
      </div>
    </header>
    <main id="workspace" class="page-shell">
      <section class="intro" aria-labelledby="page-title">
        <h1 id="page-title">Ekstraksi Multi-Palet Warna</h1>
        <p class="lede">Ubah satu gambar (screenshot film, foto arsitektur, atau ilustrasi) menjadi beberapa palet warna fungsional lengkap dengan kode HEX (#000000–#FFFFFF) dan RGB.</p>
      </section>
      <section class="workspace-card two-panel-workspace" aria-label="Ruang kerja ekstraksi palet">
        ${state.error ? `<div class="message error" role="alert">${escapeHtml(state.error)}</div>` : ''}
        ${sourceMarkup()}
        ${paletteMarkup()}
        ${exportMarkup()}
      </section>
    </main>
    <footer>
      <p>Tugas Mata Kuliah Visi Komputer · Pemrosesan Lokal di Browser (Web Worker)</p>
      <p>Utama · Web Design · Arsitektur</p>
    </footer>
    <dialog class="info-dialog" id="info-dialog" aria-labelledby="info-title">
      <div class="dialog-heading">
        <div><p class="eyebrow">Metodologi Visi Komputer</p><h2 id="info-title">Bagaimana 3 palet dihasilkan?</h2></div>
        <button class="dialog-close" id="close-info" type="button" aria-label="Tutup informasi">×</button>
      </div>
      <section>
        <h3>Pra-pemrosesan &amp; Ruang Warna Perseptual</h3>
        <ol>
          <li>Gambar di-resize maksimal 800px dan disampel hingga 50.000 piksel secara deterministik.</li>
          <li>Kandidat warna diekstrak dengan gabungan K-Means deterministik (gradien alami) dan Histogram 3D terkuantisasi (aksen kecil tajam).</li>
          <li>Semua jarak warna dan penyesuaian kecerahan dihitung di ruang warna perseptual <strong>CIE Lab</strong> serta luminansi relatif <strong>WCAG</strong>.</li>
        </ol>
      </section>
      <div class="algorithm-guide">
        <article>
          <p class="guide-number">01</p>
          <h3>Palet Utama</h3>
          <p>Mengambil <strong>7 warna mayoritas mentah</strong> langsung berdasarkan dominansi piksel tanpa mengubah kecerahan maupun saturasi asli gambar.</p>
        </article>
        <article>
          <p class="guide-number">02</p>
          <h3>Palet Web Design</h3>
          <p>Menentukan Background &amp; Surface netral, mengangkat warna ber-<em>Chroma</em> tinggi sebagai Primary/Accent (<em>saliency-weighted</em>), dan memastikan kontras Teks vs Background minimal <strong>WCAG AA/AAA</strong>.</p>
        </article>
        <article>
          <p class="guide-number">03</p>
          <h3>Palet Arsitektur</h3>
          <p>Menerapkan aturan ruang <strong>60–30–10</strong>: meredam kejenuhan dinding (60%) agar LRV nyaman bagi mata, memisahkan material furnitur (30%), aksen dekorasi (10%), trim plafon, dan fixture.</p>
        </article>
      </div>
    </dialog>
    <div class="toast" role="status" aria-live="polite">${escapeHtml(state.notice)}</div>
  `;
  bindEvents();
}

function requestExtraction(): void {
  if (!state.image) return;
  state.busy = true;
  state.error = '';
  state.notice = '';
  state.requestId += 1;
  const transferable = state.image.pixels.slice();
  worker.postMessage({
    id: state.requestId,
    pixels: transferable,
    options: {
      categories: [...state.categories],
      webTheme: state.webTheme,
    },
  }, [transferable.buffer]);
  render();
}

async function useImage(source: ImageSource): Promise<void> {
  state.imageUrl = typeof source === 'object' && !(source instanceof File) ? source.url : '';
  state.busy = true;
  state.error = '';
  state.notice = '';
  state.palettes = [];
  state.imageStats = null;
  render();
  try {
    state.image = source === 'sample'
      ? await createSampleImage()
      : source instanceof File
        ? await loadImage(source)
        : await loadImageFromUrl(source.url);
    state.imageUrl = '';
    requestExtraction();
  } catch (error) {
    state.busy = false;
    state.error = error instanceof Error ? error.message : 'Gambar tidak dapat dibuka.';
    render();
  }
}

async function copyText(value: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  state.notice = message;
  render();
  window.setTimeout(() => {
    if (state.notice === message) {
      state.notice = '';
      render();
    }
  }, 1800);
}

function bindEvents(): void {
  const input = document.querySelector<HTMLInputElement>('#image-input');
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void useImage(file);
  });
  document.querySelector('#sample-image')?.addEventListener('click', () => void useImage('sample'));
  document.querySelector<HTMLFormElement>('#image-url-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = document.querySelector<HTMLInputElement>('#image-url')?.value.trim();
    if (url) void useImage({ url });
  });

  document.querySelector<HTMLSelectElement>('#theme-select')?.addEventListener('change', (event) => {
    const theme = (event.target as HTMLSelectElement).value;
    if (!isThemePreference(theme)) return;
    state.theme = theme;
    applyTheme(theme);
  });

  const dropZone = document.querySelector<HTMLElement>('#drop-zone');
  dropZone?.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void useImage(file);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category as PaletteCategory | undefined;
      if (!cat) return;
      const exists = state.categories.includes(cat);
      if (exists && state.categories.length === 1) {
        state.notice = 'Minimal 1 profil palet harus aktif.';
        render();
        return;
      }
      if (exists) {
        state.categories = state.categories.filter((c) => c !== cat);
      } else {
        const order: PaletteCategory[] = ['utama', 'web', 'arsitektur'];
        state.categories = order.filter((c) => c === cat || state.categories.includes(c));
      }
      if (state.image) requestExtraction();
      else render();
    });
  });

  document.querySelector<HTMLSelectElement>('#web-theme-select')?.addEventListener('change', (event) => {
    state.webTheme = (event.target as HTMLSelectElement).value as WebThemePreference;
    if (state.image) requestExtraction();
    else render();
  });

  document.querySelector<HTMLSelectElement>('#output-format')?.addEventListener('change', (event) => {
    state.exportFormat = (event.target as HTMLSelectElement).value as MultiExportFormat;
    state.codeOpen = true;
    render();
  });

  const infoDialog = document.querySelector<HTMLDialogElement>('#info-dialog');
  document.querySelector('#open-info')?.addEventListener('click', () => infoDialog?.showModal());
  document.querySelector('#close-info')?.addEventListener('click', () => infoDialog?.close());
  infoDialog?.addEventListener('click', (event) => {
    if (event.target === infoDialog) infoDialog.close();
  });

  document.querySelector<HTMLDetailsElement>('.code-disclosure')?.addEventListener('toggle', (event) => {
    state.codeOpen = (event.currentTarget as HTMLDetailsElement).open;
  });

  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((swatch) => swatch.addEventListener('click', () => {
    const value = swatch.dataset.copy;
    if (value) void copyText(value, `${value} disalin`);
  }));

  document.querySelector('#copy-code')?.addEventListener('click', () =>
    void copyText(formatMultiPalette(state.palettes, state.exportFormat), 'Semua palet disalin'),
  );

  document.querySelector('#download-code')?.addEventListener('click', () => {
    const blob = new Blob([formatMultiPalette(state.palettes, state.exportFormat)], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `multi-palette.${state.exportFormat}`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.querySelector('#remove-image')?.addEventListener('click', () => {
    state.image = null;
    state.palettes = [];
    state.imageStats = null;
    state.error = '';
    state.notice = '';
    render();
  });
}

window.addEventListener('paste', (event) => {
  const file = [...event.clipboardData?.files ?? []].find((candidate) => candidate.type.startsWith('image/'));
  if (file) void useImage(file);
});

render();
