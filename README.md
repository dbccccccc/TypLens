# TypLens

Current model: **TypLens-V1** (release **v1**).

Native image-to-Typst recognition for printed formula screenshots.
This is a separate experimental model release from IBEM-im2typst, using the
29.4M-parameter native SX checkpoint. It does not convert whole documents.

This repository distributes **model weights and their metadata only**.
Training code, training data, optimizer state, and runtime binaries are omitted.

Download the **v1** release assets:

- `typlens-v1-fp32-onnx.zip`: best-quality cached ONNX pair, 118.0 MB of weights.
- `typlens-v1-int8-onnx.zip`: compact cached ONNX pair, 33.9 MB of weights.

The Hugging Face model repository named **TypLens** additionally supplies
the full FP32 safetensors checkpoint and both ONNX variants in one place.
Each ZIP includes the tokenizer, configuration, license notices, checksums,
and [inference contract](INFERENCE.md). Supply an ONNX Runtime application to use it.

Both variants scored 38/47 on the repeatedly used paper development set.
These results are not independent test accuracy. Full precision scored 128/135
on the other validation formulas; INT8 scored 127/135 and failed to terminate
on one example. Review the outputs; this is an experimental release.

MIT for the released project contributions, retaining upstream notices.
See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the pretrained-model and
dataset provenance. No training code is required by this MIT grant.
