import { createNativeRecognizer } from "./native-inference.js";

let model;
const sha256 = async (bytes) => Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (value) => value.toString(16).padStart(2, "0"),
).join("");

async function verifiedAsset(baseUrl, path, record, progress) {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    progress(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (bytes.length !== record.bytes || await sha256(bytes) !== record.sha256) {
    throw new Error(`The local ${path} file does not match the selected model.`);
  }
  return bytes;
}

self.onmessage = async ({ data }) => {
  const { id, action } = data;
  try {
    if (action === "initialize") {
      const started = performance.now();
      const { manifest, variant, baseUrl, runtimeUrl } = data;
      if (manifest.schema_version !== "native-gray-browser-v1" ||
          manifest.input?.channels !== 1 ||
          manifest.vocabulary_size !== 1199 || !["fp32", "q8"].includes(variant)) {
        throw new Error("Unsupported native Typst model configuration.");
      }
      const selected = manifest.variants[variant];
      const total = selected.bytes + manifest.token_bytes.bytes;
      let completed = 0;
      const download = async (path, record) => {
        const bytes = await verifiedAsset(baseUrl, path, record, (received) => {
          self.postMessage({ id, progress: { phase: "download", received: completed + received, total } });
        });
        completed += bytes.length;
        return bytes;
      };
      const pieces = JSON.parse(new TextDecoder().decode(
        await download("token-bytes.json", manifest.token_bytes),
      ));
      const encoderBytes = await download(`${variant}/encoder.onnx`, selected.files["encoder.onnx"]);
      const decoderBytes = await download(`${variant}/decoder.onnx`, selected.files["decoder.onnx"]);
      self.postMessage({ id, progress: { phase: "initialize" } });
      const ort = await import(/* @vite-ignore */ new URL("ort.webgpu.min.mjs", runtimeUrl).href);
      const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.wasmPaths = runtimeUrl;
      ort.env.wasm.numThreads = threads;
      model = await createNativeRecognizer(ort, encoderBytes, decoderBytes, pieces, { channels: manifest.input.channels });
      self.postMessage({ id, result: { threads, initializationMilliseconds: performance.now() - started } });
    } else if (action === "recognize") {
      if (!model) throw new Error("The model is not ready yet.");
      const result = await model.recognize(data.pixels, (tokenCount) => {
        self.postMessage({ id, progress: { phase: "decoder", tokenCount } });
      });
      self.postMessage({ id, result });
    } else {
      throw new Error("Unknown recognition action.");
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
