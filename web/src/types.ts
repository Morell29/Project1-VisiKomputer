export type ExtractionMode = 'natural' | 'graphic' | 'balanced';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface WeightedColour extends RGB {
  weight: number;
}

export interface ExtractionOptions {
  mode: ExtractionMode;
  count: number;
  minDistance: number;
}

export type OutputFormat = 'javascript' | 'css' | 'json' | 'p5js' | 'processing' | 'glsl';
export type DisplayFormat = 'hex' | 'rgb';

export interface SharedPalette {
  version: 1;
  colours: RGB[];
  mode: ExtractionMode;
  count: number;
  minDistance: number;
  format: OutputFormat;
  displayFormat: DisplayFormat;
}

export interface ModeDefinition {
  id: ExtractionMode;
  label: string;
  description: string;
}

export const MODE_DEFINITIONS: readonly ModeDefinition[] = [
  { id: 'natural', label: 'Natural', description: 'Faithful colours for photographs' },
  { id: 'graphic', label: 'Graphic', description: 'Dominant colours from flat artwork' },
  { id: 'balanced', label: 'Balanced', description: 'A wider range from across the image' },
];

export type PaletteCategory = 'utama' | 'web' | 'arsitektur';
export type WebThemePreference = 'auto' | 'light' | 'dark';
export type ColourTemperature = 'Warm' | 'Cool' | 'Neutral';

export interface PaletteCategoryDefinition {
  id: PaletteCategory;
  label: string;
  description: string;
}

export const PALETTE_CATEGORIES: readonly PaletteCategoryDefinition[] = [
  {
    id: 'utama',
    label: 'Utama (7 Warna)',
    description: 'Ekstraksi mentah 7 warna mayoritas berdasarkan proporsi piksel gambar',
  },
  {
    id: 'web',
    label: 'Web Design',
    description: '5 peran semantik UI (Background, Surface, Primary, Accent, Text) dengan kontras WCAG',
  },
  {
    id: 'arsitektur',
    label: 'Arsitektur',
    description: 'Komposisi ruang 60–30–10 dengan kendali LRV, saturasi dinding, dan suhu warna',
  },
];

export interface MultiPaletteOptions {
  categories: PaletteCategory[];
  webTheme: WebThemePreference;
}

export interface PaletteSwatch extends RGB {
  hex: string;
  name: string;
  role: string;
  proportion?: number;
  lrv: number;
  temperature: ColourTemperature;
  contrastWithBg?: number;
  note?: string;
}

export interface GeneratedPalette {
  id: PaletteCategory;
  title: string;
  subtitle: string;
  description: string;
  swatches: PaletteSwatch[];
  meta: {
    themeMode?: 'light' | 'dark';
    wcagSummary?: string;
    ratioRule?: string;
    dominantTemp?: ColourTemperature;
  };
}

export interface ImageColourStats {
  averageLightness: number;
  warmRatio: number;
  chromaMean: number;
}

export interface MultiPaletteResult {
  palettes: GeneratedPalette[];
  imageStats: ImageColourStats;
}
