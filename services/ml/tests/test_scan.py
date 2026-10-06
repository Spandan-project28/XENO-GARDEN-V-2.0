"""Plant Scan endpoint. Uses the real downloaded model when present (python -m app.fetch_model)."""
import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ.pop("ML_API_KEY", None)
from app.main import app  # noqa: E402
from app.scan import MODEL_DIR  # noqa: E402

client = TestClient(app)
has_model = (MODEL_DIR / "model.onnx").exists()


def jpeg(color=(40, 140, 60), size=(640, 480)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def test_rejects_empty_and_non_images():
    assert client.post("/v1/scan/predict", files={"image": ("x.jpg", b"", "image/jpeg")}).status_code == 400
    if has_model:
        r = client.post("/v1/scan/predict", files={"image": ("x.jpg", b"not an image", "image/jpeg")})
        assert r.status_code == 400


@pytest.mark.skipif(not has_model, reason="model not downloaded")
def test_predicts_top5_with_probabilities():
    r = client.post("/v1/scan/predict", files={"image": ("leaf.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    body = r.json()
    preds = body["predictions"]
    assert len(preds) == 5
    assert all(0 <= p["confidence"] <= 1 for p in preds)
    assert preds == sorted(preds, key=lambda p: -p["confidence"])
    assert body["model"]["name"]


@pytest.mark.skipif(has_model, reason="only meaningful without a model")
def test_missing_model_is_a_clear_503():
    r = client.post("/v1/scan/predict", files={"image": ("leaf.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 503
    assert "fetch_model" in r.json()["detail"]
