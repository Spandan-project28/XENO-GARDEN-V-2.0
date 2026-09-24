# Plugging a plant-health model into Xeno Garden

Plant health is designed so a machine-learning model can be added **without touching the app or the device**. This guide explains how.

## How it fits together

```
app ──► POST /v1/plants/:id/health/run ──► InsightsService
                                              │ builds HealthInput (7 days, hourly)
                                              ▼
                                   ProviderRegistry  [ ML provider → rules ]
                                              │ first provider that succeeds wins
                                              ▼
                               HealthReport (stored, shown in the app)
```

- `apps/backend/src/modules/insights/provider.ts` defines the **`PlantHealthProvider`** port. A provider gets a `HealthInput` and returns `{ score, status, summary, findings }`.
- `rules.ts` is the always-available **rule-based** provider.
- `ml.ts` is the **HTTP adapter** for a model service. It's enabled by setting `ML_SERVICE_URL`. If the service is slow (> 10 s), down, or replies off-contract, the registry falls back to the rules, and users still get a report.
- `services/ml` is a ready-to-run **FastAPI** model service with a transparent baseline model you replace.

## The contract

`packages/shared/test-vectors/ml-contract.json` holds one real request and response. **Both** the backend adapter tests and the Python service tests check against it, so the two sides can't drift apart.

**Request** (`POST /v1/health/predict`, header `x-ml-key` if `ML_API_KEY` is set):

| Field | Meaning |
|---|---|
| `plant` | `{id, name, species}`; species is free text, may be null |
| `device.settings` | The user's targets: `moistureLow/High`, `highTempC`, `maxPumpRunSec`… |
| `window` | `{from, to}` ISO timestamps (7 days) |
| `readings[]` | Hourly buckets: `soilMoisture`, `temperature`, `humidity` (null = no data), `rain`/`pump` = fraction of the hour (0–1) |
| `pumpEvents[]` | Watering sessions: `source` (auto/manual), `reason`, `stopReason` (`max_runtime` = safety stop), `durationSec` |
| `imageUrl` | Signed, short-lived URL of the newest plant photo, or null (see "Images" below) |

**Response:**

```json
{
  "model": { "name": "my-model", "version": "1.2.0" },
  "score": 0-100 or null,
  "status": "healthy" | "attention" | "critical" | "unknown",
  "summary": "One friendly sentence for the user.",
  "findings": [{ "code": "dry_spells", "severity": "info|warning|critical", "message": "…", "confidence": 0.0-1.0 }]
}
```

Return `status: "unknown"` with `score: null` when you can't judge, for example when there's too little data. The app shows it honestly.

### Finding codes

The app shows any finding. Reusing these codes keeps the wording and icons consistent:

`dry_spells`, `waterlogging`, `pump_safety_stops`, `frequent_watering`, `heat_stress`, `moisture_unstable`, `sensor_gaps`, `moisture_on_target`

For new ones such as image diagnoses, use short snake_case codes like `leaf_spot`, `powdery_mildew`, `nutrient_deficiency`, `pests_aphids`. To give a new code its own icon, add it to the mapping in `apps/mobile/src/features/insights/PlantHealthScreen.tsx` (`Finding`). The UI works without that step.

## Bringing your own model

1. **Features.** `services/ml/app/model.py → features()` already extracts useful tabular features: soil mean/std/min, dry share, data gaps, max temperature, pump hours, safety stops. Use it to build training rows.
2. **Training data.** Export history with the API (`GET /v1/devices/:id/readings?from&to&resolution=1h`) and pair it with labels: the plant's actual condition, collected via the health screen, photos, or your own notes.
3. **Implement** a class with `info` and `predict(req) -> PredictResponse` (the `HealthModel` protocol). Load your artefact (ONNX, scikit-learn, PyTorch…) in `__init__`.
4. **Register** it in `load_model()` and select it with `MODEL=<name>`.
5. **Test.** `cd services/ml && pytest`. The contract tests must still pass.
6. **Deploy** the service (the `Dockerfile` is included). On the backend set:
   ```
   ML_SERVICE_URL=https://ml.your-domain.com
   ML_API_KEY=<long random string, same on both sides>
   ML_MODEL_NAME=my-model
   ```
   Reports will then show *AI model* in the app. The provider name is stored as `ml:<name>` and the version as `<model>@<version>`.

## Images

Turn on `EXPO_PUBLIC_FLAG_PHOTO_UPLOAD=true` for the app build. The Plant Health screen then offers **Take photo / Choose**:

1. The app asks `POST /v1/plants/:id/photos/upload-url` and gets a 10-minute signed PUT URL.
2. It uploads the JPEG/PNG/WebP straight to that URL. The server checks the real file type and a 5 MB limit.
3. It calls `POST /v1/plants/:id/photos {photoId, analyze: true}`. This runs a health check whose `imageUrl` is a 1-hour signed link your model can download.

Storage sits behind the `ObjectStorage` interface (`apps/backend/src/modules/media/storage.ts`). `LocalDiskStorage` works for a single server. For cloud storage, implement the same two methods with S3/R2 presigned URLs.

## Checklist when changing the contract

- [ ] Update `packages/shared/test-vectors/ml-contract.json`
- [ ] Update `services/ml/app/schemas.py`, then `pytest`
- [ ] Update `apps/backend/src/modules/insights/ml.ts`, then `npm run test -w @xeno/backend`
- [ ] Mention it in this file
