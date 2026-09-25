import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(await readFile(path.join(root, "model-source.json"), "utf8"));

async function matches(file, expected) {
  try {
    if ((await stat(file)).size !== expected.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === expected.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function download(name, expected) {
  const dest = path.join(root, "public/model", name);
  if (await matches(dest, expected)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  const partial = dest + ".download";
  console.log(`Downloading ${name} (${(expected.bytes / 1e6).toFixed(1)} MB)…`);
  try {
    const response = await fetch(new URL(expected.remote, source.base_url), {
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if (!await matches(partial, expected)) throw new Error("File size or SHA-256 mismatch");
    await rename(partial, dest);
  } catch (error) {
    await rm(partial, { force: true });
    throw new Error(`Could not prepare ${name}: ${error.message}. Retry npm run setup. See README.md for manual/offline setup.`);
  }
}

try {
  for (const [name, expected] of Object.entries(source.runtime_files)) {
    const dest = path.join(root, "public/ort", name);
    if (await matches(dest, expected)) continue;
    const installed = path.join(root, "node_modules/onnxruntime-web/dist", name);
    if (!await matches(installed, expected)) {
      throw new Error("ONNX Runtime Web 1.22.0 is missing or differs from the pinned runtime. Run npm ci first.");
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(installed, dest);
  }
  for (const [name, expected] of Object.entries(source.files)) await download(name, expected);
  console.log("TypLens V1.1 full and compact models are ready. Images are never uploaded.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
