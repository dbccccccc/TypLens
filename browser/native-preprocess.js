import { resizeBicubic } from "./preprocess.js";

export const NATIVE_PREPROCESS_VERSION = "native-content-box-gray-v2";
export const DEFAULT_NATIVE_PREPROCESS = Object.freeze({ mode: "crop", marginRatio: 0.02, grayscale: true });

const composite = (rgba, offset, channel) => {
  const alpha = rgba[offset + 3];
  return Math.floor((rgba[offset + channel] * alpha + 255 * (255 - alpha) + 127) / 255);
};

function luminance(rgba, offset) {
  return Math.round((77 * composite(rgba, offset, 0) + 150 * composite(rgba, offset, 1) +
    29 * composite(rgba, offset, 2)) / 256);
}

// Use the mask only to locate ink. Never binarize or remove small components
// from the pixels sent to the recognizer: dots, accents and primes are content.
export function nativeContentBox(rgba, width, height, { normalizePolarity = true } = {}) {
  const histogram = new Uint32Array(256);
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        histogram[luminance(rgba, 4 * (y * width + x))] += 1;
        edgeCount += 1;
      }
    }
  }
  let background = 255;
  let cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= Math.ceil(edgeCount / 2)) { background = value; break; }
  }
  const inverted = normalizePolarity && background < 128;
  if (inverted) background = 255 - background;
  let left = width, top = height, right = -1, bottom = -1, inkPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gray = luminance(rgba, 4 * (y * width + x));
      if ((inverted ? 255 - gray : gray) <= background - 12) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        inkPixels += 1;
      }
    }
  }
  return { bounds: inkPixels ? { left, top, right, bottom } : null, background, inverted, inkPixels };
}

export function preprocessNativeRgba(rgba, width, height, options = DEFAULT_NATIVE_PREPROCESS) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 50_000_000 || rgba.length !== 4 * width * height) {
    throw new Error("Invalid formula image dimensions.");
  }
  const { mode = DEFAULT_NATIVE_PREPROCESS.mode, marginRatio = DEFAULT_NATIVE_PREPROCESS.marginRatio,
    grayscale = DEFAULT_NATIVE_PREPROCESS.grayscale } = options;
  if (!["legacy", "crop"].includes(mode) || !Number.isFinite(marginRatio) || marginRatio < 0 || marginRatio > 0.5) {
    throw new Error("Invalid formula preprocessing settings.");
  }
  if (typeof grayscale !== "boolean") throw new Error("Invalid formula grayscale setting.");
  const content = mode === "crop" ? nativeContentBox(rgba, width, height, options) : null;
  const bounds = content?.bounds;
  // Rebuild margins even when the original crop touches the ink. One pixel
  // minimum retains the faint antialias fringe just outside the detection mask.
  const margin = bounds ? Math.max(1, Math.round((bounds.bottom - bounds.top + 1) * marginRatio)) : 0;
  const left = bounds ? bounds.left - margin : 0;
  const top = bounds ? bounds.top - margin : 0;
  const sourceWidth = bounds ? bounds.right - bounds.left + 1 + 2 * margin : width;
  const sourceHeight = bounds ? bounds.bottom - bounds.top + 1 + 2 * margin : height;
  if (sourceWidth * sourceHeight > 50_000_000) {
    throw new Error("Normalized formula image is too large. Choose a smaller formula image.");
  }
  const channels = grayscale ? 1 : 3;
  const pixels = new Float32Array(channels * 384 * 384);
  for (let channel = 0; channel < (grayscale ? 1 : 3); channel += 1) {
    const source = new Uint8Array(sourceWidth * sourceHeight);
    source.fill(content?.background ?? 255);
    for (let y = 0; y < sourceHeight; y += 1) {
      const originalY = top + y;
      if (originalY < 0 || originalY >= height) continue;
      for (let x = 0; x < sourceWidth; x += 1) {
        const originalX = left + x;
        if (originalX < 0 || originalX >= width) continue;
        const offset = 4 * (originalY * width + originalX);
        const value = grayscale ? luminance(rgba, offset) : composite(rgba, offset, channel);
        source[y * sourceWidth + x] = content?.inverted ? 255 - value : value;
      }
    }
    const resized = resizeBicubic(source, sourceWidth, sourceHeight, 384, 384);
    for (let i = 0; i < resized.length; i += 1) {
      // HF rescales to float32 before subtracting the float32 mean.
      pixels[channel * 384 * 384 + i] = (Math.fround(resized[i] / 255) - 0.5) / 0.5;
    }
  }
  return { pixels, width, height, channels, preprocessing: { version: NATIVE_PREPROCESS_VERSION, mode,
    marginRatio, margin, grayscale, channels, bounds: bounds ?? null, inverted: content?.inverted ?? false,
    sourceWidth, sourceHeight } };
}

export async function prepareNativeImage(bytes, mimeType = "image/png", options = DEFAULT_NATIVE_PREPROCESS) {
  const started = performance.now();
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap;
  if (width < 1 || height < 1 || width * height > 50_000_000) {
    bitmap.close();
    throw new Error("Choose a formula image smaller than 50 megapixels.");
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  return { ...preprocessNativeRgba(rgba, width, height, options), milliseconds: performance.now() - started };
}
