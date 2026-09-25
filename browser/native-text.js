// MFR byte-level token decoding only. The generated language is already Typst.
export function decodeNativeMfrTokens(ids, pieces) {
  if (!Array.isArray(ids) || ids.length < 2 || ids[0] !== 1) {
    throw new Error("Expected a sequence beginning with the model start token.");
  }
  const natural_eos = ids.at(-1) === 2;
  const body = natural_eos ? ids.slice(1, -1) : ids.slice(1);
  let byteLength = 0;
  let invalid_special = false;
  for (const id of body) {
    if (!Number.isInteger(id) || id < 0 || id >= pieces.length) {
      throw new Error("Token ID is outside the model vocabulary.");
    }
    if (id < 5) { invalid_special = true; continue; }
    if (!Array.isArray(pieces[id])) throw new Error("Token byte mapping is missing.");
    byteLength += pieces[id].length;
  }
  const bytes = new Uint8Array(byteLength);
  let cursor = 0;
  for (const id of body) {
    if (id < 5) continue;
    bytes.set(pieces[id], cursor);
    cursor += pieces[id].length;
  }
  let decoded_text = null;
  let invalid_utf8 = false;
  try { decoded_text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { invalid_utf8 = true; }
  const error = !natural_eos ? "generation-incomplete" : invalid_special ? "reserved-token-generated" : invalid_utf8 ? "invalid-utf8-output" : !decoded_text.trim() ? "empty-output" : null;
  return { decoded_text, typst: error ? null : decoded_text, natural_eos, invalid_special,
    output_language: "typst", invalid_utf8, error };
}
