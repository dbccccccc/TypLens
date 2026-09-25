// Pillow-compatible uint8 BICUBIC: a=-0.5, antialias when shrinking,
// normalized 22-bit coefficients, horizontal then vertical with uint8 clipping.
// Algorithm reference: Pillow 12.2.0 src/libImaging/Resample.c.
// Explicit arithmetic avoids browser-dependent Canvas interpolation.
export const RESAMPLER_VERSION = "pillow-bicubic-u8-v1";
const PRECISION = 2 ** 22;

function cubic(value) {
  const x = Math.abs(value);
  if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * -0.5;
  return 0;
}

function coefficients(input, output) {
  const scale = input / output;
  const filterScale = Math.max(1, scale);
  const support = 2 * filterScale;
  return Array.from({ length: output }, (_, position) => {
    const center = (position + 0.5) * scale;
    const start = Math.max(0, Math.trunc(center - support + 0.5));
    const end = Math.min(input, Math.trunc(center + support + 0.5));
    const weights = Array.from({ length: end - start }, (_, i) =>
      cubic((i + start - center + 0.5) * (1 / filterScale)));
    const sum = weights.reduce((a, b) => a + b, 0);
    return { start, weights: weights.map(w => {
      const normalized = sum ? w / sum : w;
      return Math.trunc(normalized * PRECISION + (normalized < 0 ? -0.5 : 0.5));
    }) };
  });
}

const clip = sum => Math.min(255, Math.max(0, Math.floor(sum / PRECISION)));

export function resizeBicubic(pixels, width, height, targetWidth, targetHeight) {
  if (![width, height, targetWidth, targetHeight].every(x => Number.isInteger(x) && x > 0)
      || pixels.length !== width * height) throw new Error("Invalid resize dimensions.");
  let horizontal = pixels;
  if (targetWidth !== width) {
    const columns = coefficients(width, targetWidth);
    horizontal = new Uint8Array(targetWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const { start, weights } = columns[x];
        let sum = PRECISION / 2;
        for (let k = 0; k < weights.length; k++) sum += pixels[y * width + start + k] * weights[k];
        horizontal[y * targetWidth + x] = clip(sum);
      }
    }
  }
  if (targetHeight === height) return new Uint8Array(horizontal);
  const rows = coefficients(height, targetHeight);
  const result = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const { start, weights } = rows[y];
    for (let x = 0; x < targetWidth; x++) {
      let sum = PRECISION / 2;
      for (let k = 0; k < weights.length; k++) sum += horizontal[(start + k) * targetWidth + x] * weights[k];
      result[y * targetWidth + x] = clip(sum);
    }
  }
  return result;
}
