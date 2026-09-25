import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeNativeMfrTokens } from "../native-text.js";
import { checkVisualFormulaText } from "../visual-policy.js";
import { nativeEncoderInput } from "../native-inference.js";

test("single-channel models use grayscale directly; old RGB graphs get a compatibility copy", () => {
  const gray = new Float32Array(384 * 384).fill(.25);
  assert.equal(nativeEncoderInput(gray, 1), gray);
  const rgb = nativeEncoderInput(gray, 3);
  assert.equal(rgb.length, 3 * gray.length);
  assert.ok(rgb.every(value => value === .25));
  assert.throws(() => nativeEncoderInput(rgb, 1), /channels/);
});

test("native Typst decoding preserves UTF-8 split across tokens and literal syntax", () => {
  const pieces = [[], [], [], [], [], [0xcf], [0x81], [...new TextEncoder().encode(' _ ( c ) = sqrt( x + 1 )')]];
  const result = decodeNativeMfrTokens([1, 5, 6, 7, 2], pieces);
  assert.equal(result.typst, "ρ _ ( c ) = sqrt( x + 1 )");
  assert.equal(result.error, null);
});

test("unfinished or invalid native outputs cannot be delivered as Typst", () => {
  const pieces = [[], [], [], [], [], [120], [0xff]];
  for (const ids of [[1, 5], [1, 5, 3, 2], [1, 6, 2], [1, 2]]) {
    const result = decodeNativeMfrTokens(ids, pieces);
    assert.equal(result.typst, null);
    assert.ok(result.error);
  }
});

test("native formula checks accept math layout but reject executable code", () => {
  assert.equal(checkVisualFormulaText("mat(delim: #none, align: #center, x; y)").accepted, true);
  assert.equal(checkVisualFormulaText('#read("secret.txt")').accepted, false);
  assert.equal(checkVisualFormulaText("sqrt( x + 1").accepted, false);
});

test("webpage binds both precisions to the completed single-channel checkpoint", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/model/deployment.json", import.meta.url)));
  assert.equal(manifest.default_variant, "fp32");
  assert.equal(manifest.source_model_sha256, "d42cfd2da242a11ecdb1fe8727ee01e6896a116cd46f74357c4fdce90eebe788");
  assert.equal(manifest.checkpoint_step, 33544);
  assert.equal(manifest.input.channels, 1);
  assert.equal(manifest.inference_conversion, "none");
  assert.equal(manifest.release_qualified, false);
  for (const variant of ["fp32", "q8"]) {
    const files = manifest.variants[variant].files;
    assert.equal(manifest.variants[variant].bytes, files["encoder.onnx"].bytes + files["decoder.onnx"].bytes);
  }
});
