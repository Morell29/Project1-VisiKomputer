import { extractMultiPalettes } from './multi-palette';
import type { MultiPaletteOptions, MultiPaletteResult, RGB } from '../types';

export interface ExtractionRequest {
  id: number;
  pixels: Uint8Array;
  options: MultiPaletteOptions;
}

export interface ExtractionResponse {
  id: number;
  result: MultiPaletteResult;
  error?: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ExtractionRequest>) => void) | null;
  postMessage: (response: ExtractionResponse) => void;
};

workerScope.onmessage = ({ data }: MessageEvent<ExtractionRequest>) => {
  try {
    const pixels: RGB[] = [];
    for (let index = 0; index + 2 < data.pixels.length; index += 3) {
      pixels.push({
        r: data.pixels[index] ?? 0,
        g: data.pixels[index + 1] ?? 0,
        b: data.pixels[index + 2] ?? 0,
      });
    }
    const result = extractMultiPalettes(pixels, data.options);
    workerScope.postMessage({ id: data.id, result });
  } catch (error) {
    workerScope.postMessage({
      id: data.id,
      result: {
        palettes: [],
        imageStats: { averageLightness: 50, warmRatio: 0.5, chromaMean: 0 },
      },
      error: error instanceof Error ? error.message : 'Ekstraksi palet gagal.',
    });
  }
};
