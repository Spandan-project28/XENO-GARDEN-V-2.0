"""
Xeno Garden plant-health model service.

    uvicorn app.main:app --port 8000

Env: MODEL (default "baseline"), ML_API_KEY (if set, requests must send header x-ml-key).
The backend calls POST /v1/health/predict when ML_SERVICE_URL is configured and falls back to
its rule-based provider if this service is unreachable.
"""
import os

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile

from .model import load_model
from .scan import ScanModelMissing, get_classifier
from .schemas import PredictRequest, PredictResponse

app = FastAPI(title="Xeno Garden ML", version="0.1.0")
model = load_model(os.environ.get("MODEL", "baseline"))


def require_key(x_ml_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ML_API_KEY")
    if expected and x_ml_key != expected:
        raise HTTPException(status_code=401, detail="invalid key")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model": model.info.model_dump()}


@app.post("/v1/health/predict", response_model=PredictResponse, dependencies=[Depends(require_key)])
def predict(req: PredictRequest) -> PredictResponse:
    return model.predict(req)


MAX_IMAGE_BYTES = 8 * 1024 * 1024


@app.post("/v1/scan/predict", dependencies=[Depends(require_key)])
async def scan_predict(image: UploadFile = File(...)) -> dict:
    """Plant Scan: leaf photo (multipart field "image") -> top predictions."""
    data = await image.read()
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="send one image up to 8 MB in the 'image' field")
    try:
        clf = get_classifier()
    except ScanModelMissing as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    try:
        predictions = clf.predict(data)
    except Exception as e:  # unreadable / not an image
        raise HTTPException(status_code=400, detail="could not read the image") from e
    return {"model": {"name": clf.name, "version": "1"}, "predictions": predictions}
