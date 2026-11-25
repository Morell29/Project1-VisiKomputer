import type { ColourTemperature, RGB } from '../types';

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normaliseRgb(colour: RGB): RGB {
  return {
    r: clampChannel(colour.r),
    g: clampChannel(colour.g),
    b: clampChannel(colour.b),
  };
}

export function rgbToHex(colour: RGB): string {
  const { r, g, b } = normaliseRgb(colour);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHexUpper(colour: RGB): string {
  return rgbToHex(colour).toUpperCase();
}

function linearise(channel: number): number {
  const value = clampChannel(channel) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function delinearise(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  const srgb = clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
  return clampChannel(srgb * 255);
}

export function rgbToLab(colour: RGB): Lab {
  const r = linearise(colour.r);
  const g = linearise(colour.g);
  const b = linearise(colour.b);

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const transform = (value: number) =>
    value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Converts perceptual CIE Lab coordinates back to clamped sRGB.
 * Used to tune lightness or chroma while keeping the image's hue character intact.
 */
export function labToRgb(lab: Lab): RGB {
  const fy = (lab.l + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;

  const invTransform = (t: number) => {
    const t3 = t ** 3;
    return t3 > 0.008856451679 ? t3 : (t - 16 / 116) / 7.787037037;
  };

  const x = invTransform(fx) * 0.95047;
  const y = invTransform(fy);
  const z = invTransform(fz) * 1.08883;

  const rLin = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gLin = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const bLin = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return {
    r: delinearise(rLin),
    g: delinearise(gLin),
    b: delinearise(bLin),
  };
}

export function labChroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

export function labDistance(first: Lab, second: Lab): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

export function colourDistance(first: RGB, second: RGB): number {
  return labDistance(rgbToLab(first), rgbToLab(second));
}

export function relativeLuminance(colour: RGB): number {
  const r = linearise(colour.r);
  const g = linearise(colour.g);
  const b = linearise(colour.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: RGB, second: RGB): number {
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function lightReflectanceValue(colour: RGB): number {
  return Math.round(relativeLuminance(colour) * 1000) / 10;
}

export function colourTemperature(colour: RGB): ColourTemperature {
  const lab = rgbToLab(colour);
  const chroma = labChroma(lab);
  if (chroma < 7) return 'Neutral';
  // Warm colors carry positive red/yellow components (+a, +b) in CIE Lab
  const warmIndex = lab.a * 0.65 + lab.b * 0.85;
  if (warmIndex > 4) return 'Warm';
  if (warmIndex < -4) return 'Cool';
  return 'Neutral';
}

export function rgbDistanceSquared(first: RGB, second: RGB): number {
  return (first.r - second.r) ** 2 + (first.g - second.g) ** 2 + (first.b - second.b) ** 2;
}
