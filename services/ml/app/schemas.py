"""Request/response models — the contract in packages/shared/test-vectors/ml-contract.json."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Plant(BaseModel):
    id: str
    name: str
    species: Optional[str] = None


class Settings(BaseModel):
    moistureLow: float
    moistureHigh: float
    maxPumpRunSec: int
    cooldownSec: int
    rainLockout: bool
    highTempC: float = 38
    telemetryIntervalSec: int = 5


class Device(BaseModel):
    id: str
    settings: Settings


class Window(BaseModel):
    from_: str = Field(alias="from")
    to: str


class Reading(BaseModel):
    """Hourly bucket. rain/pump are 0..1 fractions of the hour."""

    ts: str
    soilMoisture: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    rain: float = 0
    pump: float = 0


class PumpEvent(BaseModel):
    source: Literal["auto", "manual", "safety"]
    reason: str
    stopReason: Optional[str] = None
    startedAt: str
    durationSec: Optional[float] = None


class PredictRequest(BaseModel):
    plant: Plant
    device: Optional[Device] = None
    window: Window
    readings: list[Reading] = []
    pumpEvents: list[PumpEvent] = []
    imageUrl: Optional[str] = None


class Finding(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    severity: Literal["info", "warning", "critical"]
    message: str
    confidence: float = Field(ge=0, le=1)


class ModelInfo(BaseModel):
    name: str
    version: str


class PredictResponse(BaseModel):
    model: ModelInfo
    score: Optional[float] = Field(default=None, ge=0, le=100)
    status: Literal["healthy", "attention", "critical", "unknown"]
    summary: str
    findings: list[Finding] = []
