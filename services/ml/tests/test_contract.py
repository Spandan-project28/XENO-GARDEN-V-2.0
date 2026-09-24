"""Checks the service against the shared contract fixture used by the backend adapter tests."""
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "packages" / "shared" / "test-vectors" / "ml-contract.json").read_text(encoding="utf-8")
)

os.environ.pop("ML_API_KEY", None)
from app.main import app  # noqa: E402
from app.schemas import PredictResponse  # noqa: E402

client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["model"]["name"] == "baseline"


def test_contract_request_is_accepted_and_response_has_contract_shape():
    r = client.post("/v1/health/predict", json=CONTRACT["request"])
    assert r.status_code == 200, r.text
    body = r.json()
    # same keys as the contract response
    assert set(body.keys()) == set(CONTRACT["response"].keys())
    PredictResponse.model_validate(body)
    # too few hours in the fixture → the baseline declines politely
    assert body["status"] == "unknown"


def test_contract_example_response_is_valid():
    PredictResponse.model_validate(CONTRACT["response"])


def test_scores_a_full_week():
    req = dict(CONTRACT["request"])
    base = CONTRACT["request"]["readings"][0]
    req["readings"] = [{**base, "soilMoisture": 38 + (i % 4)} for i in range(168)]
    body = client.post("/v1/health/predict", json=req).json()
    assert body["status"] == "healthy"
    assert body["score"] >= 75


def test_api_key_is_enforced(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "s3cret")
    assert client.post("/v1/health/predict", json=CONTRACT["request"]).status_code == 401
    ok = client.post("/v1/health/predict", json=CONTRACT["request"], headers={"x-ml-key": "s3cret"})
    assert ok.status_code == 200
