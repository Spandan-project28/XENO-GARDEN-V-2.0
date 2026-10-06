"""
Downloads the default Plant Scan model (~9 MB) into services/ml/models/plant-disease/.

    cd services/ml
    python -m app.fetch_model
"""
import sys
import urllib.request

from .scan import MODEL_DIR

REPO = "https://huggingface.co/onnx-community/mobilenet_v2_1.0_224-plant-disease-identification-ONNX/resolve/main"
FILES = {"model.onnx": "onnx/model.onnx", "config.json": "config.json", "preprocessor_config.json": "preprocessor_config.json"}


def main() -> int:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, remote in FILES.items():
        dest = MODEL_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"ok      {name}")
            continue
        print(f"getting {name} ...", flush=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(f"{REPO}/{remote}", tmp)
        tmp.replace(dest)
    print(f"Model ready in {MODEL_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
