# TypLens V1.1

V1.1 introduces a newly trained single-channel grayscale model and matched
training/browser preprocessing for printed formula images. It uses the final
33,544-step checkpoint and generates Typst directly.

- Full FP32 ONNX: **117.2 MB** of model weights.
- Compact dynamic INT8 ONNX: **33.1 MB**, 71.7% smaller.
- Native FP32 safetensors, tokenizer and configuration are available on
  [Hugging Face](https://huggingface.co/dbcccc/TypLens).
- Both ONNX variants have completed desktop Edge/WASM smoke checks.

**Migration:** the input changes from three RGB channels to one luminance channel.
Adopt the preprocessing in INFERENCE.md and replace the encoder and decoder
together. Old V1 RGB preprocessing cannot be used with these weights.

The server FP32 checkpoint received 127/135 content passes on a reused development
set under assistant review. This is not independent accuracy or a compact-model
benchmark. The model card explains the scope and remaining errors.

Attach `typlens-v1.1-fp32-onnx.zip` and `typlens-v1.1-int8-onnx.zip` to this release.
Each asset includes its model pair, token bytes, preprocessing contract and license
notices. The release contains no training code. The MIT license and upstream
attribution are retained.
