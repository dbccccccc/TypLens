import { decodeNativeMfrTokens } from "./native-text.js";

function dispose(tensor) {
  tensor?.dispose?.();
}

export function nativeEncoderInput(pixels, channels) {
  if (!(pixels instanceof Float32Array) || ![1, 3].includes(channels)) {
    throw new Error("Invalid formula input tensor.");
  }
  const size = 384 * 384;
  if (pixels.length === channels * size) return pixels;
  // Compatibility with the previously published RGB graphs only. Newly trained
  // grayscale encoders consume the original one-channel buffer without copying.
  if (channels === 3 && pixels.length === size) {
    const expanded = new Float32Array(3 * size);
    for (let c = 0; c < 3; c += 1) expanded.set(pixels, c * size);
    return expanded;
  }
  throw new Error("Formula image channels do not match the model.");
}

export async function createNativeRecognizer(ort, encoderBytes, decoderBytes, pieces, { channels = 3 } = {}) {
  const started = performance.now();
  if (pieces.length !== 1199) throw new Error("Model vocabulary mismatch");
  const encoder = await ort.InferenceSession.create(encoderBytes, { executionProviders: ["wasm"] });
  let decoder;
  try { decoder = await ort.InferenceSession.create(decoderBytes, { executionProviders: ["wasm"] }); }
  catch (error) { await encoder.release(); throw error; }
  return {
    initializationMilliseconds: performance.now() - started,
    async release() { await encoder.release(); await decoder.release(); },
    async recognize(pixels, progress = () => {}) {
      const input = nativeEncoderInput(pixels, channels);
      const before = performance.now();
      const image = new ort.Tensor("float32", input, [1, channels, 384, 384]);
      let encoded, keys, values;
      const ids = [1];
      let encoderMilliseconds;
      try {
        const encoderStart = performance.now();
        encoded = await encoder.run({ pixel_values: image });
        encoderMilliseconds = performance.now() - encoderStart;
        keys = new ort.Tensor("float32", new Float32Array(0), [6, 1, 8, 0, 32]);
        values = new ort.Tensor("float32", new Float32Array(0), [6, 1, 8, 0, 32]);
        const decoderStart = performance.now();
        for (let step = 0; step < 1023; step += 1) {
          const token = new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.at(-1))]), [1, 1]);
          let output;
          try {
            output = await decoder.run({ token_ids: token, self_keys: keys, self_values: values,
              cross_keys: encoded.cross_keys, cross_values: encoded.cross_values });
          } finally {
            dispose(token);
          }
          dispose(keys); dispose(values);
          keys = output.self_keys_out; values = output.self_values_out;
          const logits = output.logits.data;
          let top = 0;
          try {
            if (logits.length !== 1199 || pieces.length !== 1199) throw new Error("Model vocabulary mismatch");
            for (let i = 0; i < logits.length; i += 1) {
              if (!Number.isFinite(logits[i])) throw new Error("Nonfinite model output");
              if (logits[i] > logits[top]) top = i;
            }
          } finally { dispose(output.logits); }
          ids.push(top);
          if (top === 2) break;
          if (step % 20 === 0) progress(ids.length - 1);
        }
        return { ...decodeNativeMfrTokens(ids, pieces), token_ids_with_bos: ids,
          encoderMilliseconds, decoderMilliseconds: performance.now() - decoderStart,
          inferenceMilliseconds: performance.now() - before,
          cacheBytes: (6 * 8 * 32 * 2 * (578 + ids.length - 1)) * 4 };
      } finally {
        dispose(image);dispose(keys);dispose(values);
        if (encoded) { dispose(encoded.cross_keys);dispose(encoded.cross_values); }
      }
    },
  };
}
