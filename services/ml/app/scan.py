"""
Leaf-disease image classifier for Plant Scan (local stand-in until your own model is connected).

Default model: MobileNetV2 fine-tuned on PlantVillage (38 classes, 14 crops), ONNX export
`onnx-community/mobilenet_v2_1.0_224-plant-disease-identification-ONNX` — downloaded once by
`python -m app.fetch_model` into services/ml/models/ (git-ignored). Accurate on clear single-leaf
photos; weaker on busy real-garden backgrounds.

Any other ONNX image classifier works too: put `model.onnx` + a Hugging Face style `config.json`
(id2label) + `preprocessor_config.json` in SCAN_MODEL_DIR.
"""
from __future__ import annotations

import io
import json
import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MODEL_DIR = Path(os.environ.get("SCAN_MODEL_DIR", Path(__file__).resolve().parents[1] / "models" / "plant-disease"))


class ScanModelMissing(RuntimeError):
    pass


class LeafClassifier:
    def __init__(self, model_dir: Path = MODEL_DIR):
        import onnxruntime as ort

        onnx = model_dir / "model.onnx"
        if not onnx.exists():
            raise ScanModelMissing(f"No model at {onnx}. Run: python -m app.fetch_model")
        cfg = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        pre_path = model_dir / "preprocessor_config.json"
        pre = json.loads(pre_path.read_text(encoding="utf-8")) if pre_path.exists() else {}
        self.labels = {int(k): v for k, v in cfg["id2label"].items()}
        self.name = cfg.get("_name_or_path") or model_dir.name
        crop = pre.get("crop_size") or {"height": 224, "width": 224}
        self.crop = (int(crop["width"]), int(crop["height"]))
        size = pre.get("size") or {}
        self.shortest = int(size.get("shortest_edge", max(self.crop)))
        self.mean = np.array(pre.get("image_mean", [0.5, 0.5, 0.5]), dtype=np.float32)
        self.std = np.array(pre.get("image_std", [0.5, 0.5, 0.5]), dtype=np.float32)
        self.session = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name

    def preprocess(self, data: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")  # phone photos carry their rotation in EXIF
        w, h = img.size
        scale = self.shortest / min(w, h)
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
        w, h = img.size
        cw, ch = self.crop
        left, top = (w - cw) // 2, (h - ch) // 2
        img = img.crop((left, top, left + cw, top + ch))
        x = np.asarray(img, dtype=np.float32) / 255.0
        x = (x - self.mean) / self.std
        return x.transpose(2, 0, 1)[None, ...].astype(np.float32)

    def predict(self, data: bytes, top: int = 5) -> list[dict]:
        logits = self.session.run(None, {self.input: self.preprocess(data)})[0][0]
        e = np.exp(logits - logits.max())
        probs = e / e.sum()
        order = np.argsort(-probs)[:top]
        return [{"label": self.labels[int(i)], "confidence": round(float(probs[i]), 4)} for i in order]


_lock = threading.Lock()
_model: LeafClassifier | None = None


def get_classifier() -> LeafClassifier:
    """Loaded on first use, so the health endpoints work even without the image model."""
    global _model
    with _lock:
        if _model is None:
            _model = LeafClassifier()
        return _model
