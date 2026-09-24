"""
Model interface + a baseline implementation.

To plug in a trained model, implement `HealthModel.predict()` (e.g. load an ONNX / scikit-learn /
PyTorch artefact in __init__) and select it with the MODEL env var in `load_model()`.
See docs/ML_INTEGRATION.md for the feature contract and finding codes.
"""
from __future__ import annotations

import statistics
from typing import Protocol

from .schemas import Finding, ModelInfo, PredictRequest, PredictResponse


class HealthModel(Protocol):
    info: ModelInfo

    def predict(self, req: PredictRequest) -> PredictResponse: ...


def features(req: PredictRequest) -> dict[str, float]:
    """Compact numeric features most tabular models want (also handy for training data)."""
    soil = [r.soilMoisture for r in req.readings if r.soilMoisture is not None]
    temp = [r.temperature for r in req.readings if r.temperature is not None]
    s = req.device.settings if req.device else None
    n = max(1, len(req.readings))
    return {
        "hours": float(len(req.readings)),
        "soil_mean": statistics.fmean(soil) if soil else 0.0,
        "soil_std": statistics.pstdev(soil) if len(soil) > 1 else 0.0,
        "soil_min": min(soil) if soil else 0.0,
        "dry_share": (sum(1 for v in soil if s and v < s.moistureLow) / len(soil)) if soil and s else 0.0,
        "gap_share": 1 - len(soil) / n,
        "temp_max": max(temp) if temp else 0.0,
        "pump_hours": sum(r.pump for r in req.readings),
        "safety_stops": float(sum(1 for e in req.pumpEvents if e.stopReason == "max_runtime")),
    }


class BaselineModel:
    """Transparent placeholder: a small linear score over the features. Replace with a trained model."""

    info = ModelInfo(name="baseline", version="0.1.0")

    def predict(self, req: PredictRequest) -> PredictResponse:
        f = features(req)
        if f["hours"] < 12 or not req.device:
            return PredictResponse(model=self.info, score=None, status="unknown", summary="Not enough data for the model yet.")
        score = 100.0
        score -= 60 * f["dry_share"]
        score -= 40 * f["gap_share"]
        score -= min(20.0, f["soil_std"])
        score -= 10 * f["safety_stops"]
        score = max(0.0, min(100.0, round(score, 1)))
        status = "healthy" if score >= 75 else "attention" if score >= 40 else "critical"
        findings: list[Finding] = []
        if f["dry_share"] > 0.1:
            findings.append(Finding(code="dry_spells", severity="warning", message=f"Soil was below target {round(f['dry_share'] * 100)}% of the time.", confidence=0.6))
        if f["safety_stops"]:
            findings.append(Finding(code="pump_safety_stops", severity="warning", message="The pump hit its safety limit; check the water supply.", confidence=0.8))
        if not findings:
            findings.append(Finding(code="moisture_on_target", severity="info", message="Moisture mostly in range.", confidence=0.7))
        return PredictResponse(
            model=self.info,
            score=score,
            status=status,
            summary=f"{req.plant.name} looks {'healthy' if status == 'healthy' else 'like it needs attention' if status == 'attention' else 'stressed'}.",
            findings=findings,
        )


def load_model(name: str) -> HealthModel:
    if name == "baseline":
        return BaselineModel()
    raise ValueError(f"Unknown MODEL '{name}'")
