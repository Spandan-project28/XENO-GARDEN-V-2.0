# Plant Scan: leaf disease detection

**Flow:**
1. Open the app's **Scan** tab and take or pick a photo of one leaf.
2. Preview it, choose which garden it's in, then tap **Analyze**.
3. The photo is uploaded to the Xeno server, which sends it to the **disease model API** you configured.
4. The model's answer becomes one standard result: crop, condition, confidence, severity, what to do now, prevention, and **tips from that garden's live sensors** (humidity, soil, rain, temperature).
5. You land on the result screen. The latest scan also shows on the Garden dashboard, and every scan is listed in the Scan tab.

The model is plugged in by **configuration only**. No code changes are needed to switch models.

---

## Connect your model API (2 minutes)

1. Open `apps/backend/.env`. Git ignores it, so it's never committed. Create it if it's missing.
2. Fill in the lines for your API (examples below).
3. Restart `npm run dev`. The server log says `plant scan: model connected`, and the app's Scan tab stops showing "Disease model not connected".

> Keep the API key in `.env` only. It stays on the server. The phone never sees it, and it's never written to logs.

### Hugging Face (Inference API / Inference Endpoint)
```env
SCAN_API_PRESET=huggingface
SCAN_API_URL=https://router.huggingface.co/hf-inference/models/<user>/<model>
SCAN_API_KEY=hf_xxxxxxxxxxxxxxxx
```

### Roboflow (classification model)
```env
SCAN_API_PRESET=roboflow
SCAN_API_URL=https://classify.roboflow.com/<model-id>/<version>
SCAN_API_KEY=xxxxxxxxxxxx
```

### crop.health (Kindwise)
```env
SCAN_API_PRESET=kindwise
SCAN_API_KEY=xxxxxxxxxxxx
# optional: SCAN_API_BODY_EXTRA={"similar_images":false}
```

### Your own API (Flask / FastAPI / Node / anything)
```env
SCAN_API_URL=https://my-model.example.com/predict
SCAN_API_KEY=xxxxxxxx              # leave out if your API has no key
SCAN_API_AUTH=bearer               # bearer | header:<Name> | query:<param> | none
SCAN_API_REQUEST=multipart         # multipart | json-base64 | raw | form-base64
SCAN_API_IMAGE_FIELD=image         # form/JSON field that carries the photo
SCAN_API_MODEL_NAME=My leaf model  # shown under each result
```

**Request formats:**
- `multipart`: a normal file upload in the `image` field. This is what Flask's `request.files['image']` and FastAPI's `UploadFile` expect.
- `json-base64`: `{"image": "<base64>"}`. If the field name ends in `s` (e.g. `images`), it sends `{"images": ["data:image/jpeg;base64,…"]}`.
- `raw`: the image bytes as the body, with `Content-Type: image/jpeg`.
- `form-base64`: the base64 text as a form body (Roboflow style).

**Responses are read automatically.** All of these work as-is:
```jsonc
[{"label": "Tomato___Early_blight", "score": 0.93}, …]                // Hugging Face
{"predictions": [{"class": "Leaf_Mold", "confidence": 0.81}], …}       // Roboflow
{"predictions": {"Leaf_Mold": {"confidence": 0.7}, …}}                 // Roboflow multi-label
{"label": "Apple scab", "confidence": 0.64}                            // single result
{"prediction": "Potato___healthy", "probability": 97}                  // percentages are fine
"Grape___Black_rot"                                                    // just a label
```
For anything unusual, point at the fields:
```env
SCAN_API_RESULTS_PATH=output.top       # where the list of predictions is (dot path, 0-based indexes)
SCAN_API_LABEL_KEY=k                   # label field in each prediction
SCAN_API_CONFIDENCE_KEY=p              # score field (0–1 or 0–100)
SCAN_API_CROP_PATH=result.crop.name    # optional: crop name, if separate from the label
SCAN_API_IS_PLANT_PATH=result.is_plant # optional: "is this a plant?" flag
```

**Labels:** any wording works. "Tomato___Early_blight", "Tomato with Early Blight" and "early blight" all match the built-in catalogue, which covers all 38 PlantVillage classes plus common garden problems, each with treatment and prevention advice. A label it doesn't know is still shown, with advice for its type (fungal, bacterial, viral, pest, nutrient).

**Tuning:**
- `SCAN_MIN_CONFIDENCE=0.55`: below this, the result says "Not sure" and asks for a better photo instead of guessing.
- `SCAN_TIMEOUT_MS=30000`: how long to wait for the model.

---

## Without your own model yet: the local model

The repo includes a real disease classifier you can run on the laptop: MobileNetV2 trained on PlantVillage (38 classes, 14 crops).

```bash
cd services/ml
pip install -r requirements.txt
python -m app.fetch_model     # downloads ~9 MB into services/ml/models/ (git-ignored)
```

After this, `npm run dev` starts it automatically **whenever no `SCAN_API_URL`/`SCAN_API_PRESET` is set in `apps/backend/.env`**. As soon as you add your own API, yours is used instead.

It's accurate on clear photos of a single leaf (like the PlantVillage images) and less reliable on busy garden backgrounds. Treat it as a stand-in.

---

## What the user sees when something is wrong

| Situation | Message in the app |
|---|---|
| No model configured | "Disease model not connected" banner, and Analyze is disabled |
| Wrong key (401/403) | "The disease model rejected the API key. Check SCAN_API_KEY." |
| Usage limit (429) | "The disease model's usage limit was reached. Try again later." |
| Model cold start (503 "loading") | "The disease model is warming up. Try again in about 20 seconds." |
| Timeout / unreachable | "The disease model took too long…" / "Could not reach the disease model…" |
| Unreadable answer | "The disease model's answer could not be read." (the server log shows the raw reply, with the key removed) |
| Low confidence | Result "Not sure", with the best guess and how to retake the photo |
| No leaf in the photo | Result "No leaf found" |

Plant Scan is independent of irrigation. A missing or broken model config never stops the server, the devices or the dashboard.

---

## Where things live

| Part | Files |
|---|---|
| Shared contract | `packages/shared/src/schemas/scan.ts` |
| Server module | `apps/backend/src/modules/scans/`:<br>`config.ts` (SCAN_* settings), `detector.ts` (calls your API), `parse.ts` (reads any response), `labels.ts` + `catalog.ts` (conditions and advice), `advice.ts` (result + sensor tips), `service.ts`, `routes.ts`, `model.ts` (collection `plant_scans`) |
| API | `GET /v1/scans/status`, `POST /v1/scans/upload-url`, `POST /v1/scans`, `GET /v1/scans`, `GET /v1/scans/:id`, `DELETE /v1/scans/:id` |
| App | `apps/mobile/src/features/scan/`: Scan tab, analyze step, result screen, dashboard card (flag `EXPO_PUBLIC_FLAG_PLANT_SCAN`, on by default) |
| Local model | `services/ml/app/scan.py`, `POST /v1/scan/predict` |
| Tests | `apps/backend/test/unit/scanLogic.test.ts`, `apps/backend/test/int/scans.test.ts` (a real HTTP model server per API style), `apps/mobile/src/features/scan/scan.test.tsx`, `services/ml/tests/test_scan.py` |
