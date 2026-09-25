import { formatBytes, sha256Hex } from "./core.js";
import { DEFAULT_NATIVE_PREPROCESS, prepareNativeImage } from "./native-preprocess.js";
import { createNativeClient } from "./native-client.js";
import { checkVisualFormulaText } from "./visual-policy.js";

const MAX_FILE_BYTES = 20 * 1_000_000;
const MAX_IMAGE_PIXELS = 50_000_000;
const ASSET_REVISION = "typlens-v1.1-d42cfd2d";
const MODEL_DIRECTORY = "model";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const elements = {
  modelVariant: document.querySelector("#model-variant"),
  normalizeMargins: document.querySelector("#normalize-margins"),
  modelPrecision: document.querySelector("#model-precision"),
  executionDetail: document.querySelector("#execution-detail"),
  chooseImage: document.querySelector("#choose-image"),
  clearImage: document.querySelector("#clear-image"),
  copyOutput: document.querySelector("#copy-output"),
  confidence: document.querySelector("#confidence"),
  decodeDetail: document.querySelector("#decode-detail"),
  decodeProgress: document.querySelector("#decode-progress"),
  decodeTitle: document.querySelector("#decode-title"),
  decoderTime: document.querySelector("#decoder-time"),
  dropEmpty: document.querySelector("#drop-empty"),
  dropZone: document.querySelector("#drop-zone"),
  encoderTime: document.querySelector("#encoder-time"),
  fileInput: document.querySelector("#file-input"),
  imageFacts: document.querySelector("#image-facts"),
  imageFileMeta: document.querySelector("#image-file-meta"),
  imagePreview: document.querySelector("#image-preview"),
  inputDimensions: document.querySelector("#input-dimensions"),
  inputStatus: document.querySelector("#input-status"),
  loaderProgress: document.querySelector("#loader-progress"),
  modelChip: document.querySelector("#model-chip"),
  modelChipLabel: document.querySelector("#model-chip-label"),
  modelLoadDetail: document.querySelector("#model-load-detail"),
  modelLoader: document.querySelector("#model-loader"),
  modelLoadTitle: document.querySelector("#model-load-title"),
  modelSize: document.querySelector("#model-size"),
  outputEmpty: document.querySelector("#output-empty"),
  outputNote: document.querySelector("#output-note"),
  outputResult: document.querySelector("#output-result"),
  parameterCount: document.querySelector("#parameter-count"),
  polarityState: document.querySelector("#polarity-state"),
  provisionalBanner: document.querySelector("#provisional-banner"),
  qualityMetricDetail: document.querySelector("#quality-metric-detail"),
  qualityMetricLabel: document.querySelector("#quality-metric-label"),
  processedBlock: document.querySelector("#processed-block"),
  processedCanvas: document.querySelector("#processed-canvas"),
  referenceCheck: document.querySelector("#reference-check"),
  referenceMessage: document.querySelector("#reference-message"),
  retryModel: document.querySelector("#retry-model"),
  releaseIdentity: document.querySelector("#release-identity"),
  runButton: document.querySelector("#run-model"),
  runButtonLabel: document.querySelector("#run-button-label"),
  sourceDimensions: document.querySelector("#source-dimensions"),
  sourceImage: document.querySelector("#source-image"),
  testAccuracy: document.querySelector("#test-accuracy"),
  toast: document.querySelector("#toast"),
  tokenCount: document.querySelector("#token-count"),
  totalTime: document.querySelector("#total-time"),
  typstOutput: document.querySelector("#typst-output"),
  useExample: document.querySelector("#use-example"),
};

const outputEmptyTitle = elements.outputEmpty.querySelector("strong");
const outputEmptyDetail = elements.outputEmpty.querySelector("p");
const outputNoteDetail = elements.outputNote.querySelector("p");

const state = {
  imageVersion: 0,
  client: null,
  loadingModel: false,
  model: null,
  modelError: null,
  modelPromise: null,
  lastError: null,
  lastOutcome: null,
  preparingImage: false,
  prepared: null,
  source: null,
  previewUrl: null,
  reference: null,
  running: false,
  toastTimer: null,
};

function assetUrl(relativePath) {
  const url = new URL(relativePath, globalThis.location.href);
  if (!relativePath.endsWith("/")) {
    url.searchParams.set("release", ASSET_REVISION);
  }
  return url.href;
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds.toFixed(milliseconds < 100 ? 1 : 0)} ms`;
  }
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function compactMillions(value) {
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function showToast(message, tone = "success") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", tone === "error");
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

function setModelLoad({ title, detail, progress, status = "loading" }) {
  elements.modelLoadTitle.textContent = title;
  elements.modelLoadDetail.textContent = detail;
  elements.loaderProgress.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
  elements.modelLoader.classList.toggle("is-ready", status === "ready");
  elements.modelLoader.classList.toggle("is-error", status === "error");
}

function setModelChip(status, label) {
  elements.modelChip.classList.toggle("is-loading", status === "loading");
  elements.modelChip.classList.toggle("is-ready", status === "ready");
  elements.modelChip.classList.toggle("is-error", status === "error");
  elements.modelChipLabel.textContent = label;
}

function resetMetrics() {
  elements.totalTime.textContent = "—";
  elements.encoderTime.textContent = "—";
  elements.decoderTime.textContent = "—";
  elements.tokenCount.textContent = "—";
  elements.confidence.textContent = "—";
}

function resetOutput() {
  state.lastError = null;
  state.lastOutcome = null;
  elements.outputEmpty.classList.remove("is-hidden");
  elements.outputResult.classList.add("is-hidden");
  elements.outputNote.classList.remove("is-rejected", "is-accepted");
  elements.decodeProgress.classList.add("is-hidden");
  elements.referenceCheck.classList.add("is-hidden", "is-mismatch");
  elements.typstOutput.value = "";
  elements.copyOutput.disabled = true;
  outputEmptyTitle.textContent = "Your Typst code will appear here";
  outputEmptyDetail.textContent =
    "Add a printed formula screenshot, then select Recognize formula.";
  outputNoteDetail.innerHTML =
    'Review the formula before placing it between <code>$</code> delimiters in Typst.';
  resetMetrics();
}

function setOutputError(error) {
  elements.outputResult.classList.add("is-hidden");
  elements.outputEmpty.classList.remove("is-hidden");
  outputEmptyTitle.textContent = "Inference stopped";
  outputEmptyDetail.textContent =
    error instanceof Error ? error.message : String(error);
}

function updateRunAvailability() {
  const ready =
    Boolean(state.model) &&
    Boolean(state.prepared) &&
    !state.preparingImage &&
    !state.running;
  elements.runButton.disabled = !ready;
  elements.chooseImage.disabled = state.running;
  elements.useExample.disabled = state.running;
  elements.clearImage.disabled = state.running;
  elements.fileInput.disabled = state.running;
  elements.modelVariant.disabled = state.running || state.loadingModel || state.preparingImage;
  elements.normalizeMargins.disabled = state.running || state.preparingImage;
  elements.runButton.classList.toggle("is-running", state.running);

  if (state.running) {
    elements.runButtonLabel.textContent = "Decoding…";
  } else if (state.preparingImage) {
    elements.runButtonLabel.textContent = "Preparing image…";
  } else if (state.modelError) {
    elements.runButtonLabel.textContent = "Model unavailable";
  } else if (!state.model) {
    elements.runButtonLabel.textContent = "Preparing model…";
  } else if (!state.prepared) {
    elements.runButtonLabel.textContent = "Add formula image";
  } else {
    elements.runButtonLabel.textContent = "Recognize formula";
  }
}

function validateImageBlob(blob) {
  if (!blob || blob.size === 0) {
    throw new Error("The selected image is empty.");
  }
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error("Choose an image smaller than 20 MB.");
  }
  if (blob.type && !SUPPORTED_IMAGE_TYPES.has(blob.type)) {
    throw new Error("Use a PNG, JPEG, or WebP image.");
  }
}

async function preprocessImage(blob) {
  const options = elements.normalizeMargins.checked ? DEFAULT_NATIVE_PREPROCESS : { mode: "legacy" };
  const prepared = await prepareNativeImage(await blob.arrayBuffer(), blob.type || "image/png", options);
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 384;
  previewCanvas.height = 384;
  const context = previewCanvas.getContext("2d");
  const image = context.createImageData(384, 384);
  for (let i = 0; i < 384 * 384; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      image.data[4 * i + c] = Math.round((prepared.pixels[(prepared.channels === 1 ? 0 : c) * 384 * 384 + i] + 1) * 127.5);
    }
    image.data[4 * i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return {
    tensorData: prepared.pixels,
    tensorSha256: await sha256Hex(prepared.pixels.buffer),
    preprocessingMilliseconds: prepared.milliseconds,
    preprocessing: prepared.preprocessing,
    originalWidth: prepared.width,
    originalHeight: prepared.height,
    height: 384, bucket: 384, pixelWidth: 384,
    previewCanvas,
  };
}

function renderProcessedImage(prepared) {
  elements.processedCanvas.width = prepared.bucket;
  elements.processedCanvas.height = prepared.height;
  const context = elements.processedCanvas.getContext("2d", {
    alpha: false,
    colorSpace: "srgb",
  });
  context.drawImage(prepared.previewCanvas, 0, 0);
}

async function setImage(blob, { name, reference = null } = {}) {
  validateImageBlob(blob);
  const version = state.imageVersion + 1;
  state.imageVersion = version;
  state.source = { blob, name, reference };
  state.preparingImage = true;
  state.prepared = null;
  state.reference = null;
  resetOutput();
  elements.inputStatus.textContent = "Reading and preprocessing the image…";
  updateRunAvailability();

  const nextPreviewUrl = URL.createObjectURL(blob);
  try {
    // Retain the blob in this invocation until the actual contract is available.
    // Clearing or replacing the image invalidates pending work by version.
    if (!state.model) await state.modelPromise;
    if (version !== state.imageVersion) {
      URL.revokeObjectURL(nextPreviewUrl);
      return;
    }
    if (!state.model) throw new Error("Model unavailable. Retry loading, then add the image again.");
    const prepared = await preprocessImage(blob);
    if (version !== state.imageVersion) {
      URL.revokeObjectURL(nextPreviewUrl);
      return;
    }

    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
    }
    state.previewUrl = nextPreviewUrl;
    state.prepared = prepared;
    state.reference = reference;
    state.preparingImage = false;

    elements.sourceImage.src = nextPreviewUrl;
    elements.sourceImage.alt = `Selected formula image: ${name ?? "pasted image"}`;
    elements.dropEmpty.classList.add("is-hidden");
    elements.imagePreview.classList.remove("is-hidden");
    elements.imageFacts.classList.remove("is-hidden");
    elements.processedBlock.classList.remove("is-hidden");
    elements.clearImage.classList.remove("is-hidden");
    elements.sourceDimensions.textContent =
      `${prepared.originalWidth} × ${prepared.originalHeight}`;
    elements.inputDimensions.textContent = "384 × 384 · grayscale";
    elements.inputDimensions.title = prepared.preprocessing.mode === "crop"
      ? "Formula content with normalized margins." : "Original image, including its existing margins.";
    elements.polarityState.textContent = prepared.preprocessing.inverted ? "inverted" : "as provided";
    elements.polarityState.title = prepared.preprocessing.inverted
      ? "Converted to grayscale and a light background." : "Converted to grayscale; light background preserved.";
    elements.imageFileMeta.textContent =
      `${name ?? "pasted-image.png"} · ${formatBytes(blob.size)}`;
    renderProcessedImage(prepared);

    elements.inputStatus.textContent = state.model
      ? "Image and model are ready. Run recognition."
      : "Image ready. Waiting for the local model to finish loading.";
    return true;
  } catch (error) {
    URL.revokeObjectURL(nextPreviewUrl);
    if (version === state.imageVersion) {
      state.preparingImage = false;
      state.prepared = null;
      elements.inputStatus.textContent =
        error instanceof Error ? error.message : String(error);
      showToast(elements.inputStatus.textContent, "error");
    }
    return false;
  } finally {
    updateRunAvailability();
  }
}

function clearImage() {
  state.imageVersion += 1;
  state.preparingImage = false;
  state.prepared = null;
  state.source = null;
  state.reference = null;
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  elements.sourceImage.removeAttribute("src");
  elements.fileInput.value = "";
  elements.dropEmpty.classList.remove("is-hidden");
  elements.imagePreview.classList.add("is-hidden");
  elements.imageFacts.classList.add("is-hidden");
  elements.processedBlock.classList.add("is-hidden");
  elements.clearImage.classList.add("is-hidden");
  elements.inputStatus.textContent = state.model
    ? "Add a single formula image."
    : "Add an image while the local model loads.";
  resetOutput();
  updateRunAvailability();
}

async function loadModel() {
  state.client?.close();
  state.client = null;
  state.model = null;
  state.modelError = null;
  state.loadingModel = true;
  resetOutput();
  elements.retryModel.classList.add("is-hidden");
  setModelChip("loading", "Loading TypLens V1.1");
  setModelLoad({ title: "Loading TypLens V1.1…", detail: "Preparing local recognition.", progress: 2 });
  updateRunAvailability();
  const client = createNativeClient();
  state.client = client;
  try {
    const response = await fetch(assetUrl(`${MODEL_DIRECTORY}/deployment.json`), { cache: "no-store" });
    if (!response.ok) throw new Error("Model files are missing. Run npm run setup, then reload this page.");
    const deployment = await response.json();
    const variant = elements.modelVariant.value;
    const selected = deployment.variants[variant];
    for (const option of elements.modelVariant.options) {
      const version = deployment.variants[option.value];
      option.textContent = "V1.1 · " + version.label + " · " + formatBytes(version.bytes);
    }
    const initialization = await client.request("initialize", {
      manifest: deployment, variant,
      baseUrl: assetUrl(`${MODEL_DIRECTORY}/`),
      runtimeUrl: assetUrl("ort/"),
    }, (progress) => {
      if (progress.phase === "download") {
        setModelLoad({ title: "Loading TypLens V1.1…", detail: formatBytes(progress.received) + " / " + formatBytes(progress.total), progress: 5 + 80 * progress.received / progress.total });
      } else {
        setModelLoad({ title: "Preparing recognition…", detail: "Starting the model inside your browser.", progress: 90 });
      }
    });
    state.model = { deployment, variant, ...initialization };
    elements.parameterCount.textContent = compactMillions(deployment.parameters);
    elements.modelSize.textContent = formatBytes(selected.bytes);
    elements.modelPrecision.textContent = selected.label;
    elements.qualityMetricLabel.textContent = "Input";
    elements.testAccuracy.textContent = "Grayscale";
    elements.qualityMetricDetail.textContent = "One printed formula";
    elements.provisionalBanner.hidden = false;
    elements.releaseIdentity.textContent = "TypLens V1.1 reads grayscale formula images. Both options use the same checkpoint and run locally."
      + (variant === "q8" ? " Compact uses 8-bit compression; its predictions may differ from Full precision." : " Full precision preserves the trained weights without quantization.");
    elements.executionDetail.textContent = "WASM · " + initialization.threads + (initialization.threads === 1 ? " thread" : " threads");
    setModelChip("ready", "Ready · " + selected.label);
    setModelLoad({ title: "TypLens V1.1 is ready", detail: selected.label + " · " + formatBytes(selected.bytes) + " · images stay in your browser", progress: 100, status: "ready" });
    elements.inputStatus.textContent = state.prepared ? "Image and model are ready. Run recognition." : "Model ready. Add a printed formula screenshot.";
  } catch (error) {
    client.close();
    state.modelError = error;
    const message = error instanceof Error ? error.message : String(error);
    setModelChip("error", "Load failed");
    setModelLoad({ title: "Model could not be loaded", detail: message, progress: 100, status: "error" });
    elements.retryModel.classList.remove("is-hidden");
    elements.inputStatus.textContent = "Check the local server and retry loading the model.";
    showToast(message, "error");
    throw error;
  } finally {
    state.loadingModel = false;
    updateRunAvailability();
  }
}

async function runRecognition() {
  if (!state.model || !state.prepared || state.running || state.preparingImage) return;
  state.running = true;
  resetOutput();
  elements.outputEmpty.classList.add("is-hidden");
  elements.decodeProgress.classList.remove("is-hidden");
  elements.decodeTitle.textContent = "Reading formula…";
  elements.decodeDetail.textContent = "Recognizing the image locally";
  elements.inputStatus.textContent = "Recognition is running in your browser.";
  updateRunAvailability();
  try {
    const pixels = state.prepared.tensorData.slice();
    const result = await state.client.request("recognize", { pixels }, ({ tokenCount }) => {
      elements.decodeTitle.textContent = "Writing Typst…";
      elements.decodeDetail.textContent = "Generated " + tokenCount + " tokens";
    }, [pixels.buffer]);
    const outputText = result.decoded_text ?? result.typst ?? "";
    const hasOutput = Boolean(outputText.trim());
    const policy = hasOutput ? checkVisualFormulaText(outputText) : { accepted: false, reason: result.error };
    const accepted = !result.error && policy.accepted;
    state.lastOutcome = {
      accepted, text: outputText, eosReached: result.natural_eos,
      tokenIds: result.token_ids_with_bos, tokenCount: result.token_ids_with_bos.length - 1,
      outputPolicyAccepted: policy.accepted, outputPolicyReason: policy.reason,
      variant: state.model.variant, tensorSha256: state.prepared.tensorSha256,
      error: result.error, inferenceMilliseconds: result.inferenceMilliseconds,
    };
    elements.totalTime.textContent = formatDuration(result.inferenceMilliseconds);
    elements.encoderTime.textContent = formatDuration(result.encoderMilliseconds);
    elements.decoderTime.textContent = formatDuration(result.decoderMilliseconds);
    elements.tokenCount.textContent = String(result.token_ids_with_bos.length - 1 - Number(result.natural_eos));
    elements.confidence.textContent = result.natural_eos ? "Complete" : "Incomplete";
    elements.confidence.title = "Generation status does not establish mathematical correctness.";
    elements.outputNote.classList.toggle("is-rejected", !accepted);
    elements.outputNote.classList.toggle("is-accepted", accepted);
    if (!hasOutput) {
      const reason = "No readable output was generated. (" + (result.error || policy.reason) + ")";
      state.lastError = reason;
      setOutputError(new Error(reason));
      outputNoteDetail.textContent = reason;
      elements.inputStatus.textContent = reason;
      showToast("No output was generated.", "error");
      return;
    }
    elements.outputEmpty.classList.add("is-hidden");
    elements.outputResult.classList.remove("is-hidden");
    elements.typstOutput.value = outputText;
    elements.copyOutput.disabled = false;
    if (state.reference?.expected_typst) {
      elements.referenceCheck.classList.remove("is-hidden");
      elements.referenceCheck.classList.remove("is-mismatch");
      elements.referenceMessage.textContent = "Example reference: " + state.reference.expected_typst;
    }
    if (!accepted) {
      const reason = result.error === "generation-incomplete"
        ? "Generation stopped early. Partial output is shown; you can edit or copy it."
        : "Formula checks failed (" + (result.error || policy.reason) + "). Raw output is shown; review it before use.";
      state.lastError = reason;
      outputNoteDetail.textContent = reason;
      elements.inputStatus.textContent = reason;
      showToast("Output shown with warnings.", "error");
      return;
    }
    outputNoteDetail.innerHTML = 'Review the formula, then use it between <code>$</code> delimiters in Typst.';
    elements.inputStatus.textContent = "Finished in " + formatDuration(result.inferenceMilliseconds) + ". You can edit or copy the Typst formula.";
    showToast("Typst formula ready.");
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    setOutputError(error);
    elements.inputStatus.textContent = "Recognition failed. You can try again or reload the model.";
    showToast(state.lastError, "error");
  } finally {
    elements.decodeProgress.classList.add("is-hidden");
    state.running = false;
    updateRunAvailability();
  }
}

async function copyOutput() {
  const text = elements.typstOutput.value;
  if (!text) return;
  let copied = false;
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable.");
    }
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    elements.typstOutput.select();
    copied = document.execCommand("copy");
    elements.typstOutput.setSelectionRange(0, 0);
  }
  if (!copied) {
    showToast("Clipboard access was blocked. Select the Typst text manually.", "error");
    return;
  }
  elements.copyOutput.textContent = "Copied";
  showToast("Typst copied to the clipboard.");
  window.setTimeout(() => {
    elements.copyOutput.textContent = "Copy";
  }, 1400);
}

async function loadExample() {
  elements.useExample.disabled = true;
  try {
    const metadataUrl = assetUrl("example/example.json");
    const response = await fetch(metadataUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("The included example metadata could not be loaded.");
    }
    const metadata = await response.json();
    const imageResponse = await fetch(new URL(metadata.image_url, metadataUrl), {
      cache: "no-store",
    });
    if (!imageResponse.ok) {
      throw new Error("The included example image could not be loaded.");
    }
    const blob = await imageResponse.blob();
    const file = new File([blob], "project-example.png", {
      type: blob.type || "image/png",
    });
    const loaded = await setImage(file, {
      name: file.name,
      reference: metadata,
    });
    if (loaded) showToast("Loaded the included project-owned example.");
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  } finally {
    elements.useExample.disabled = state.running;
  }
}

function openFilePicker() {
  if (!state.running) {
    elements.fileInput.click();
  }
}

elements.chooseImage.addEventListener("click", openFilePicker);
elements.dropZone.addEventListener("click", openFilePicker);
elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openFilePicker();
  }
});
elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) {
    setImage(file, { name: file.name });
  }
  elements.fileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.running) {
      elements.dropZone.classList.add("is-dragging");
      event.dataTransfer.dropEffect = "copy";
    }
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => {
  if (state.running) return;
  const file = [...event.dataTransfer.files].find((item) =>
    item.type.startsWith("image/"),
  );
  if (file) {
    setImage(file, { name: file.name });
  } else {
    showToast("Drop a PNG, JPEG, or WebP formula image.", "error");
  }
});
window.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) {
    event.preventDefault();
  }
});
window.addEventListener("drop", (event) => {
  if (
    !elements.dropZone.contains(event.target) &&
    [...event.dataTransfer.types].includes("Files")
  ) {
    event.preventDefault();
  }
});
window.addEventListener("paste", (event) => {
  if (state.running) return;
  const item = [...event.clipboardData.items].find(
    (candidate) =>
      candidate.kind === "file" && candidate.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (file) {
    event.preventDefault();
    setImage(file, { name: "pasted-formula.png" });
  }
});

elements.clearImage.addEventListener("click", clearImage);
elements.normalizeMargins.addEventListener("change", () => {
  if (state.running || !state.source) return;
  const { blob, name, reference } = state.source;
  setImage(blob, { name, reference });
});
elements.useExample.addEventListener("click", loadExample);
elements.runButton.addEventListener("click", runRecognition);
elements.copyOutput.addEventListener("click", copyOutput);
elements.modelVariant.addEventListener("change", () => {
  state.modelPromise = loadModel().catch(() => null);
});
elements.retryModel.addEventListener("click", () => {
  state.modelPromise = loadModel().catch(() => null);
});

resetOutput();
updateRunAvailability();
if (new URLSearchParams(globalThis.location.search).get("validation") === "1") {
  globalThis.__formulaAppValidation = {
    snapshot() {
      return {
        inputStatus: elements.inputStatus.textContent,
        lastError: state.lastError,
        lastOutcome: state.lastOutcome,
        modelError:
          state.modelError instanceof Error
            ? state.modelError.message
            : state.modelError
              ? String(state.modelError)
              : null,
        modelReady: Boolean(state.model),
        modelVariant: state.model?.variant,
        modelSourceSha256: state.model?.deployment.source_model_sha256,
        modelStep: state.model?.deployment.checkpoint_step,
        inputChannels: state.model?.deployment.input.channels,
        threads: state.model?.threads,
        prepared: Boolean(state.prepared),
        preparingImage: state.preparingImage,
        preprocessing: state.prepared?.preprocessing ?? null,
        tensorSha256: state.prepared?.tensorSha256 ?? null,
        running: state.running,
      };
    },
  };
}
state.modelPromise = loadModel().catch(() => null);
