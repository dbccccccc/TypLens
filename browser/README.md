# TypLens V1.1 browser inference example

Recognize one printed formula image and edit or copy its Typst math source.
The full FP32 and compact INT8 models run entirely in a browser worker. Image
decoding, grayscale preprocessing and recognition stay on your device. No account,
API key, Python, GPU server or training code is needed.

## Ready-to-run ZIP

Download [typlens-v1.1-browser.zip](https://github.com/dbccccccc/TypLens/releases/download/TypLens-V1.1/typlens-v1.1-browser.zip)
and extract it. Install **Node.js 22.13 or newer**, then open a terminal in the
extracted folder containing `serve.mjs` and run:

```sh
node serve.mjs
```

Open **http://127.0.0.1:4173/**. Both model variants and the runtime are included;
no npm installation, model download or Hugging Face login is needed for this ZIP.
Do not open index.html by double-clicking it: workers and model loading require
an HTTP server. If port 4173 is busy, use `node serve.mjs --port 4174`.

## Run from source

With Node.js 22.13 or newer installed:

```sh
git clone https://github.com/dbccccccc/TypLens.git
cd TypLens/browser
npm ci
npm start
```

First start installs the runtime assets from the npm dependency and downloads
both public model variants from the pinned Hugging Face revision. About **150.3 MB**
of weights and token bytes are downloaded. Later starts check and reuse the files.
`npm run setup` prepares them without starting the page; `node serve.mjs` starts
the page without running setup again. Keep package-lock.json for reproducible
dependency installation.

The model is pinned to revision
`f98216362a14a3b218f228ed7c007d31825d0ab1` of `dbcccc/TypLens`, with expected
SHA-256 hashes in model-source.json. No training or conversion is performed.

## Use the page

1. Wait for the model to load, then choose, drop or paste a PNG, JPEG or WebP formula.
2. Click **Recognize formula**. Switch between **Full precision** (117.2 MB) and
   **Compact** (33.1 MB) to compare outputs; the selected image is preserved.
3. Edit or copy the output. The text is the content of a Typst math expression;
   surround it with `$` delimiters when appropriate.

Available text remains visible and copyable if generation stops early or the
formula checks fail. The warning remains visible too. The lightweight checks
do not compile Typst or establish mathematical correctness. This example does
not render or execute generated Typst code.

Preprocessing uses the exact V1.1 contract: white alpha composition, one luminance
channel, background polarity normalization, the ink bounding box with a 2% margin,
Pillow-compatible bicubic resize and float32 normalization. Input shape is
`[1, 1, 384, 384]`. Keep **Normalize formula margins** enabled for the trained
default. See INFERENCE.md for the full tensor and token contract.

The included **Use example** image is the project-authored expression `x + y`,
not a training-data sample. Recognition may still make errors, particularly on
accents, indices, similar symbols and complex layouts. This is a formula model,
not a full-document converter.

## Files for application integration

| File | Purpose |
|---|---|
| native-preprocess.js, preprocess.js | Grayscale content normalization and deterministic bicubic resize |
| native-inference.js | Encoder and cached autoregressive decoder, greedy generation |
| native-text.js | Decode token bytes without LaTeX conversion |
| native-worker.js, native-client.js | Model loading and inference outside the UI thread |
| app.js, index.html, styles.css | Upload, model selection, editable output and progress |
| setup.mjs, model-source.json | Download pinned weights and prepare ONNX Runtime Web |
| serve.mjs | Local static server with WASM isolation headers |

The source example installs `onnxruntime-web` **1.22.0**. Runtime files are served
locally from public/ort; no external CDN is contacted by the page. The local
server binds only to 127.0.0.1 and accepts GET/HEAD, with no image-upload endpoint.
WASM uses up to four threads when cross-origin isolation is available, otherwise
one. Desktop Chromium/Edge is the tested target; mobile and WebGPU are not claimed.

For another static host, serve the client files in this folder plus the contents
of public/ at the same URL base. Preserve model/, ort/ and example/ paths and use
HTTPS or localhost. Set `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to enable multiple WASM threads.
Serving without these headers uses one thread. Browser runtimes and models are
large; do not commit them to ordinary Git history.

The supplied Node server is for local use. Static hosting does not need the Node
server, setup scripts or node_modules after model/runtime assets are prepared.

## Manual/offline setup

If Hugging Face is unreachable, use the ready-to-run ZIP. Alternatively, copy
the matching V1.1 model files into:

```text
public/model/fp32/encoder.onnx
public/model/fp32/decoder.onnx
public/model/q8/encoder.onnx
public/model/q8/decoder.onnx
public/model/token-bytes.json
```

Hugging Face calls the compact directory `onnx/int8`; this example calls it `q8`.
Keep the supplied deployment.json. Run `npm ci` and `npm run setup` to copy the
runtime from the installed dependency and verify the model files. A failed
download is not installed as a completed model; retry `npm run setup` to recover.

Run the existing preprocessing/decoding regression tests with `npm test`.

## License

Project inference code and the project-authored example image: MIT. Model terms
and upstream notices are retained in LICENSE, NOTICE.md and licenses/.
The ready-to-run ZIP includes ONNX Runtime Web and its MIT/third-party notices.
The Pillow-compatible resampler retains the Pillow/PIL MIT-CMU notice. No
training implementation, optimizer state or training dataset is included.
