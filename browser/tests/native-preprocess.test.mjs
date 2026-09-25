import assert from "node:assert/strict";
import test from "node:test";
import { nativeContentBox, preprocessNativeRgba } from "../native-preprocess.js";
import { resizeBicubic } from "../preprocess.js";

function formula() {
  const width = 49, height = 31;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const put = (x, y, value = 0) => { for (let c = 0; c < 3; c++) rgba[4 * (y * width + x) + c] = value; };
  for (let x = 5; x <= 42; x++) put(x, 15); // Thin fraction bar.
  for (let y = 4; y <= 12; y++) { put(10, y); put(20, y); }
  for (let y = 20; y <= 27; y++) put(15, y);
  put(43, 2); // Detached accent, intentionally only one pixel.
  put(3, 27); // Decimal point to the left of the main components.
  put(21, 7, 173); // Preserve antialias values rather than binarizing.
  return { rgba, width, height };
}

function padded(input, left, top, right, bottom) {
  const width = input.width + left + right, height = input.height + top + bottom;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < input.height; y++) {
    rgba.set(input.rgba.subarray(y * input.width * 4, (y + 1) * input.width * 4), ((y + top) * width + left) * 4);
  }
  return { rgba, width, height };
}

test("content normalization is invariant to added symmetric and asymmetric white borders", () => {
  const base = formula();
  for (const marginRatio of [0.02, 0.06, 0.12]) {
    const options = { mode: "crop", marginRatio };
    const expected = preprocessNativeRgba(base.rgba, base.width, base.height, options).pixels;
    for (const altered of [padded(base, 12, 12, 12, 12), padded(base, 31, 4, 2, 27)]) {
      assert.deepEqual(preprocessNativeRgba(altered.rgba, altered.width, altered.height, options).pixels, expected);
    }
  }
});

test("the crop retains disconnected dots, accents and one-pixel bars", () => {
  const input = formula();
  const result = nativeContentBox(input.rgba, input.width, input.height);
  assert.deepEqual(result.bounds, { left: 3, top: 2, right: 43, bottom: 27 });
  assert.ok(result.inkPixels > 40);
});

test("tight crops receive new margins even when there are no original margins", () => {
  const input = formula();
  const tight = new Uint8ClampedArray(41 * 26 * 4);
  for (let y = 0; y < 26; y++) {
    tight.set(input.rgba.subarray(((y + 2) * 49 + 3) * 4, ((y + 2) * 49 + 44) * 4), y * 41 * 4);
  }
  const options = { mode: "crop", marginRatio: .06 };
  const original = preprocessNativeRgba(input.rgba, 49, 31, options);
  const cropped = preprocessNativeRgba(tight, 41, 26, options);
  assert.deepEqual(cropped.pixels, original.pixels);
  assert.ok(cropped.preprocessing.sourceHeight > 26);
});

test("opaque dark-mode and transparent black-on-clear inputs retain the same formula", () => {
  const input = formula();
  const inverse = Uint8ClampedArray.from(input.rgba, (value, i) => i % 4 === 3 ? value : 255 - value);
  const transparent = input.rgba.slice();
  for (let i = 0; i < transparent.length; i += 4) {
    transparent[i + 3] = 255 - input.rgba[i];
    transparent[i] = transparent[i + 1] = transparent[i + 2] = 0;
  }
  const options = { mode: "crop", marginRatio: .06 };
  const expected = preprocessNativeRgba(input.rgba, 49, 31, options).pixels;
  assert.deepEqual(preprocessNativeRgba(inverse, 49, 31, options).pixels, expected);
  assert.deepEqual(preprocessNativeRgba(transparent, 49, 31, options).pixels, expected);
});

test("legacy mode preserves the previous alpha, bicubic and float32 operations", () => {
  const width = 7, height = 5;
  const rgba = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 79 + 13) % 256);
  const result = preprocessNativeRgba(rgba, width, height, { mode: "legacy", grayscale: false });
  for (let c = 0; c < 3; c++) {
    const plane = Uint8Array.from({ length: width * height }, (_, i) => {
      const alpha = rgba[4 * i + 3];
      return Math.floor((rgba[4 * i + c] * alpha + 255 * (255 - alpha) + 127) / 255);
    });
    const resized = resizeBicubic(plane, width, height, 384, 384);
    const expected = Float32Array.from(resized, value => (Math.fround(value / 255) - .5) / .5);
    assert.deepEqual(result.pixels.subarray(c * 384 * 384, (c + 1) * 384 * 384), expected);
  }
});

test("colored inputs become a single luminance channel before resizing", () => {
  const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 0, 0, 0, 128]);
  const result = preprocessNativeRgba(rgba, 4, 1, { mode: "legacy" });
  const gray = Uint8Array.from([77, 149, 29, 127]);
  const expected = Float32Array.from(resizeBicubic(gray, 4, 1, 384, 384),
    value => (Math.fround(value / 255) - .5) / .5);
  assert.deepEqual(result.pixels, expected);
  assert.equal(result.channels, 1);
  assert.equal(result.preprocessing.grayscale, true);
});

test("blank images remain finite and malformed dimensions/settings are rejected", () => {
  const result = preprocessNativeRgba(new Uint8ClampedArray(16).fill(255), 2, 2, { mode: "crop" });
  assert.equal(result.preprocessing.bounds, null);
  assert.ok(result.pixels.every(value => value === 1));
  assert.throws(() => preprocessNativeRgba(new Uint8ClampedArray(4), 0, 1), /dimensions/);
  assert.throws(() => preprocessNativeRgba(new Uint8ClampedArray(4), 1, 1, { mode: "crop", marginRatio: NaN }), /settings/);
});

test("an extreme aspect ratio cannot allocate an unbounded padded image", () => {
  const width = 4, height = 20_000;
  const rgba = new Uint8ClampedArray(4 * width * height).fill(255);
  for (let y = 2; y < height - 2; y++) {
    const offset = 4 * (y * width + 1);
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
  }
  assert.throws(() => preprocessNativeRgba(rgba, width, height, { mode: "crop", marginRatio: .5 }), /too large/);
});
