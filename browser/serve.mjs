import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
const clientFiles = new Set([
  "index.html", "styles.css", "app.js", "core.js", "native-client.js", "native-worker.js",
  "native-inference.js", "native-text.js", "native-preprocess.js", "preprocess.js",
  "visual-policy.js", "formula-syntax.js",
]);
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".png": "image/png", ".onnx": "application/octet-stream", ".md": "text/plain; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  };
  const reject = (status, message) => {
    response.writeHead(status, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    response.end(message);
  };
  if (!["GET", "HEAD"].includes(request.method)) return reject(405, "Only GET and HEAD are supported.");
  try {
    let name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
    if (!name) name = "index.html";
    if (name.includes("\\") || name.includes("\0") || name.split("/").some(part => part.startsWith("."))) {
      return reject(404, "Not found");
    }
    let file;
    if (clientFiles.has(name)) file = path.join(root, name);
    else if (/^(model|ort|example)\//.test(name)) file = path.join(root, "public", name);
    else return reject(404, "Not found");
    const details = await stat(file);
    if (!details.isFile()) return reject(404, "Not found");
    response.writeHead(200, { ...headers, "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": details.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch (error) {
    reject(error.code === "ENOENT" ? 404 : 400, error.code === "ENOENT" ? "Not found" : "Invalid request");
  }
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE"
    ? `Port ${port} is in use. Try: node serve.mjs --port ${port + 1}` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`TypLens V1.1: http://127.0.0.1:${port}/\nPress Ctrl+C to stop.`));
