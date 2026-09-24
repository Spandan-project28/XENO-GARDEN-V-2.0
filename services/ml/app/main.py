"""
Xeno Garden plant-health model service.

    uvicorn app.main:app --port 8000

Env: MODEL (default "baseline"), ML_API_KEY (if set, requests must send header x-ml-key).
The backend calls POST /v1/health/predict when ML_SERVICE_URL is configured and falls back to
its rule-based provider if this service is unreachable.
"""
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .model import load_model
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
