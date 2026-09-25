export function createNativeClient() {
  const worker = new Worker(new URL("./native-worker.js", import.meta.url), { type: "module" });
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  function failAll(error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    if (data.progress) { entry.onProgress(data.progress); return; }
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  };
  worker.onerror = (event) => {
    closed = true;
    worker.terminate();
    failAll(new Error(event.message || "The local model worker stopped unexpectedly."));
  };
  return {
    request(action, payload, onProgress = () => {}, transfer = []) {
      if (closed) return Promise.reject(new Error("Reload the model before trying again."));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        try { worker.postMessage({ id, action, ...payload }, transfer); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    close() {
      closed = true;
      worker.terminate();
      failAll(new Error("Model was changed."));
    },
  };
}
