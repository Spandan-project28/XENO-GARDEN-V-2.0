# Xeno Garden — Complete Project Context (Extremely Detailed)

> Paste this entire document into a new chat to give full context for rebuilding this project from scratch, better than the current implementation.

---

## 1. What This Project Is

**Xeno Garden** is a hobby/college-project IoT smart drip-irrigation system. It automatically waters a plant/field based on soil moisture, temperature, humidity and rain data, and lets a user monitor + manually override everything from a phone app.

Three physical/logical tiers, connected only over local WiFi + plain HTTP (no cloud, no MQTT, no auth):

```
ESP32 (sensors + relay + pump)
        │  WiFi, HTTP/JSON
        ▼
Node.js/Express backend  ──►  MongoDB (Mongoose)
        │  HTTP/JSON (Axios)
        ▼
React Native mobile app (Expo SDK 54)
```

There is no message broker, no push notifications, no authentication/authorization anywhere, and no HTTPS. Everything is plaintext HTTP on a LAN, with the backend acting purely as a REST relay + a bit of automation logic + a MongoDB store.

The repo also contains hardware wiring guides (`.txt`) and presentation/pitch material (`presentation_outline.md`, `ppt_content_prompt.txt`, `tech_ppt_prompt.md`) written for a college demo/pitch — these are documentation artifacts, not application code.

---

## 2. Repository Layout (every file)

```
xeno_renewed_1/
├── README.md                          High-level architecture + API table (matches code, mostly accurate)
├── claude_context.md                  This file
├── presentation_outline.md            12-slide pitch deck outline for a college presentation
├── ppt_content_prompt.txt             Prompt text for generating a PPT
├── tech_ppt_prompt.md                 Prompt text for a "technical" PPT
│
├── backend/                           Node.js + Express + MongoDB REST API
│   ├── server.js                      Entry point: loads dotenv, connects Mongo, starts Express, global error handlers
│   ├── app.js                         Express app: helmet, cors(*), json body parser, morgan logging, route mounting, 404 + error handler
│   ├── package.json                   deps: express 5.x, mongoose 9.x, cors, helmet, morgan, dotenv, express-validator
│   ├── .env / .env.example            PORT=5000, MONGO_URI=mongodb://localhost:27017/irrigation_db, MOISTURE_THRESHOLD_LOW=30, MOISTURE_THRESHOLD_HIGH=40, TEMPERATURE_THRESHOLD=30, PH_ALERT_THRESHOLD=6, CORS_ORIGIN=*
│   ├── config/db.js                   mongoose.connect() wrapper + connection event logging
│   ├── models/
│   │   ├── Device.js                  deviceId(unique), location, isActive, lastSeen, pumpStatus(ON/OFF), autoMode(bool), manualOverrideUntil(Date, currently unused by any logic)
│   │   ├── SensorReading.js           deviceId(ref Device), soil_moisture[0-100], temperature[-40..80], humidity[0-100], rain_status(bool), ph_level[0-14,default 7] (dead field — nothing sets it anymore), pump_status(ON/OFF), automation_triggered(bool), timestamps; compound index {deviceId,createdAt}
│   │   └── AlertLog.js                deviceId(ref), type(enum PH_ALERT/LOW_MOISTURE/SYSTEM), message, severity(LOW/MEDIUM/HIGH/CRITICAL), isResolved(bool), timestamps
│   ├── controllers/
│   │   ├── sensorController.js        submitSensorData, getLatestReading, getHistory (see §4)
│   │   ├── pumpController.js          manualPumpControl, getPumpStatus, toggleAutoMode (see §4)
│   │   └── alertController.js         getAlerts (filter by device/type/resolved + pagination), resolveAlert
│   ├── services/
│   │   └── automationService.js       evaluateAutomation() — the ENTIRE automation brain (see §5)
│   ├── routes/
│   │   ├── sensorRoutes.js            POST /  , GET /latest , GET /history
│   │   ├── pumpRoutes.js              POST /manual , GET /status , POST /auto
│   │   └── alertRoutes.js             GET / , PATCH /:id/resolve
│   ├── middleware/errorHandler.js     Maps Mongoose ValidationError/CastError/duplicate-key(11000) to JSON; falls back to 500
│   ├── utils/validators.js            express-validator chains for sensor-data, pump-control, history-query
│   ├── reset_device.js                One-off maintenance script: sets ALL devices to autoMode=false, pumpStatus=OFF, manualOverrideUntil=null (run manually with `node reset_device.js`)
│   ├── out.txt / out2.txt             Stray captured console/log output committed to the repo (junk, not code)
│   ├── Dockerfile / .dockerignore     Basic containerization for the backend only (mobile/firmware not containerized)
│   └── package-lock.json
│
├── esp32/                             Firmware + hardware documentation (NOT built with PlatformIO — plain Arduino IDE sketch)
│   ├── README.md                      Library list (ArduinoJson v7+, DHT sensor library, Adafruit Unified Sensor), wiring table, setup steps
│   ├── HARDWARE_BUILD_GUIDE.txt       Full BOM (~₹2000-3200), ESP32 pin mapping incl. a pH sensor on GPIO35 (pH sensor was later removed from the real stack — doc is stale), assembly steps, calibration, troubleshooting
│   ├── pump_connection_guide.txt      Explains relay-isolated pump wiring for a SOLAR + battery + charge-controller power setup (hybrid power design used for the final demo): buck converter powers ESP32, charge-controller LOAD terminal powers pump directly through relay NO contact
│   ├── ESP8266_CONNECTION_GUIDE.txt   Alternate guide for a NodeMCU ESP8266 build with an added 16x2 I2C LCD (this variant is NOT what firmware.ino implements — firmware.ino targets ESP32 only, no LCD code exists)
│   └── firmware/
│       ├── config.h                   All tunables (see §6)
│       └── firmware.ino               Main Arduino sketch (see §6)
│
├── mobile/                            React Native app via Expo SDK 54, Expo Router NOT used — plain React Navigation
│   ├── App.js                         Wraps app in AppProvider (Context) + AppNavigator, sets StatusBar
│   ├── index.js                       Standard Expo entry: registerRootComponent(App)
│   ├── app.json                       Expo config: name "mobile", icon/splash/adaptive-icon assets, portrait-only, no plugins configured
│   ├── package.json                   React 19.1.0, React Native 0.81.5, Expo ~54, @react-navigation/native + bottom-tabs v7, axios 1.13, react-native-chart-kit 6.12, react-native-svg, @expo/vector-icons, qrcode (unused? see §10)
│   └── src/
│       ├── config/api.js              Hardcoded API_BASE_URL = "http://10.107.24.48:5000" (a specific dev machine's LAN IP — must be manually edited per network), endpoint path map, DASHBOARD_REFRESH = 1000ms
│       ├── theme/theme.js             Full design system: colors (dark violet/emerald "luxe" palette), spacing, borderRadius, typography, shadows, cardStyle — no light mode
│       ├── context/AppContext.js      Global state via React Context (see §7)
│       ├── navigation/AppNavigator.js Bottom tab navigator: Dashboard, History, Alerts, Settings (icons via Ionicons, custom active-pill styling)
│       ├── services/apiService.js     Axios instance + one function per endpoint + centralized handleError()
│       ├── screens/
│       │   ├── DashboardScreen.js     Live 2×2 sensor grid, Auto/Manual Switch, PumpToggle, pull-to-refresh, polls every 1s (see §8)
│       │   ├── HistoryScreen.js       Two LineCharts (moisture, temperature) via react-native-chart-kit, filter tabs "24H"(limit 48) / "7 Days"(limit 200) — filters are really just different history page sizes, not actual date-range queries
│       │   ├── AlertsScreen.js        FlatList of AlertItem, empty-state "All Clear", badge count
│       │   └── SettingsScreen.js      Local-only threshold + deviceId form (NOT synced to backend — see §10 bugs)
│       └── components/
│           ├── SensorCard.js          Animated (fade+slide) icon card, per-sensor-type color/icon map
│           ├── PumpToggle.js          Big circular ON/OFF button with pulse/glow animation when pump is ON
│           └── AlertItem.js           Color-coded alert row (PH_ALERT=coral, LOW_MOISTURE=amber, SYSTEM=accent)
│       └── (no tests, no TypeScript — entire mobile app is plain JS)
```

---

## 3. End-to-End Data Flow

**A. Sensor ingest / automation cycle (every 1000 ms, driven by the ESP32):**
1. ESP32 reads soil moisture (analog, GPIO34), DHT11 temp+humidity (GPIO4), rain digital (GPIO27).
2. ESP32 `POST`s JSON to `SERVER_URL` (`/api/sensor-data`) with `{deviceId, soil_moisture, temperature, humidity, rain_status, pump_status}`.
3. Backend `submitSensorData`:
   - Upserts the `Device` doc by `deviceId` (creates it with defaults on first contact — `autoMode:false`, `pumpStatus:"OFF"` — and updates `lastSeen`).
   - Calls `evaluateAutomation()` (see §5) which may decide a new pump command and persist it onto the `Device`.
   - Stores a new `SensorReading` document (this is a pure history log — one document per POST, forever, no downsampling/TTL).
   - Responds `{success, pump, automation_triggered, reading_id}`.
4. ESP32 reads `pump` field from the response and immediately drives the relay via `setRelay()`.

**B. Fast pump-command poll (every 300 ms, independent of the 1s sensor cycle):**
- ESP32 does `GET /api/pump/status?deviceId=...` and compares the returned `pump_status` to its local relay state, updating the relay only on change. This is what makes a manual toggle from the phone app feel "instant" (≤300ms) instead of waiting for the next 1s sensor cycle.

**C. Manual pump override (from mobile app):**
- User taps the big PumpToggle → `POST /api/pump/manual {deviceId, action:"ON"|"OFF"}`.
- Backend atomically `findOneAndUpdate`s the `Device.pumpStatus` (this atomicity was added specifically to fix a race condition — see §11 git history) and sets `manualOverrideUntil = now+5min` (field is set but **nothing currently reads/enforces it** — see §10).
- Backend also inserts a synthetic `SensorReading` row tagged `automation_triggered:false` carrying the last known sensor values, purely so History/graphs don't show a gap.
- The ESP32 picks up the new `pumpStatus` on its next 300ms poll.

**D. Auto/Manual mode toggle (from mobile app):**
- Dashboard's `Switch` calls `POST /api/pump/auto {deviceId, autoMode:boolean}` optimistically (UI flips immediately, reverts if the API call fails).
- This flag is the **master switch** for whether `evaluateAutomation()` is allowed to touch the pump at all (see §5, Priority 1).

**E. Alerts:**
- Only ever created from inside `evaluateAutomation()` when `soil_moisture < MOISTURE_LOW` (type `LOW_MOISTURE`, severity `CRITICAL` if `<15` else `HIGH`). The `PH_ALERT` enum value and `SYSTEM` type exist in the schema/UI color-map but **nothing in the codebase ever creates them** — pH sensing was fully removed from the stack (see commit `6a246c9`) but the alert/DB schema was never cleaned up.
- Mobile `AlertsScreen` just lists them; `PATCH /api/alerts/:id/resolve` exists in the API but **no UI button anywhere calls it** — alerts can never be resolved from the app.

---

## 4. Backend API Contract (exact, from code)

| Method | Path | Body/Query | Success response | Notes |
|---|---|---|---|---|
| POST | `/api/sensor-data` | `{deviceId, soil_moisture, temperature, humidity, rain_status}` | `201 {success, pump, automation_triggered, reading_id}` | Validated by express-validator; upserts Device; this is the ONLY write path for sensor history |
| GET | `/api/sensor-data/latest` | `?deviceId=` (optional) | `200 {success, data:{...reading, pump_status, autoMode}}` | `pump_status`/`autoMode` in the response are overridden from the **Device** doc, not the raw reading, specifically to avoid a stale ESP32 value stomping the UI |
| GET | `/api/sensor-data/history` | `?deviceId=&page=&limit=(1-500)` | `200 {success, data:[...], pagination}` | Plain skip/limit pagination, sorted `createdAt desc`, populates device deviceId+location |
| POST | `/api/pump/manual` | `{deviceId, action: "ON"|"OFF"}` | `200 {success, message, pump, override_id}` | Atomic update; also writes a synthetic SensorReading |
| GET | `/api/pump/status` | `?deviceId=` (required) | `200 {success, data:{pump_status, autoMode, automation_triggered, last_updated}}` | Polled by ESP32 every 300ms |
| POST | `/api/pump/auto` | `{deviceId, autoMode: boolean}` | `200 {success, message, autoMode}` | Master automation on/off switch |
| GET | `/api/alerts` | `?deviceId=&type=&resolved=&page=&limit=` | `200 {success, data:[...], pagination}` | |
| PATCH | `/api/alerts/:id/resolve` | — | `200 {success, message, data}` | Unused by mobile UI |
| GET | `/api/health` | — | `200 {success, message, timestamp, uptime}` | |

Global middleware: `helmet()`, `cors({origin: process.env.CORS_ORIGIN || "*"})` (wide open by default), `express.json({limit:"1mb"})`, `morgan("dev")`. 404 handler + centralized `errorHandler` translate Mongoose errors (ValidationError→400, duplicate key 11000→409, CastError→400) to JSON; anything else → 500 (stack only in dev).

**No authentication, no API keys, no rate limiting anywhere** — any device on the LAN (or beyond, if port-forwarded) can post fake sensor data or toggle the pump.

---

## 5. Automation Logic — `automationService.evaluateAutomation()` (verbatim behavior)

Priority-ordered decision tree, run on **every** incoming sensor POST:

1. **Priority 1 — Manual mode.** If `device.autoMode === false`, the function returns immediately with `pumpCommand = device.pumpStatus` unchanged and `automationTriggered:false`. Automation is fully inert unless the user has explicitly flipped the dashboard's Auto switch ON.
2. **Priority 2 — Rain safety.** If `autoMode` is true and `rain_status === true` → force `pumpCommand = "OFF"`, `automationTriggered = true`.
3. **Priority 3 — Moisture thresholds** (only reached if no rain):
   - `soil_moisture < MOISTURE_LOW` (env `MOISTURE_THRESHOLD_LOW`, default 30) → `pumpCommand = "ON"`.
   - `soil_moisture > MOISTURE_HIGH` (env `MOISTURE_THRESHOLD_HIGH`, default 40) → `pumpCommand = "OFF"`.
   - Between the two thresholds → **hold** the current pump state (hysteresis band, intentional — prevents rapid on/off flapping).
4. If the automation decision actually changed `pumpCommand` vs. `device.pumpStatus`, persist it to the `Device` document.
5. Independently of all the above, if `soil_moisture < MOISTURE_LOW`, always create a `LOW_MOISTURE` alert (severity `CRITICAL` if `<15%` else `HIGH`) — **this fires on every single sensor POST while moisture stays low**, i.e. potentially once per second, with no debounce/de-duplication. This is a real bug: a dry sensor floods `AlertLog` with near-duplicate rows indefinitely.

**Important discrepancy vs. README:** the README/`claude_context.md` (old version) documents the rule as "Pump ON if moisture<30% AND temp>30°C AND no rain," implying temperature is part of the ON condition. **The actual code never checks temperature at all** — `TEMPERATURE_THRESHOLD` env var is defined but unused anywhere in the codebase. Also `pH < 6.0` alert is documented but not implemented (pH was removed from the stack).

---

## 6. ESP32 Firmware — Exact Behavior (`firmware.ino` + `config.h`)

**Pins (per config.h, GPIO26 relay — this changed multiple times in history, see §11):**
- GPIO4 = DHT11 data, GPIO34 = soil moisture analog (12-bit ADC, 11dB attenuation), GPIO27 = rain sensor digital (INPUT_PULLUP, `LOW` = rain detected), GPIO26 = relay control (active-LOW module: `digitalWrite(LOW)` = pump ON, `HIGH` = pump OFF).

**Boot sequence:** Sets relay pin HIGH (pump OFF) before anything else for safety → inits DHT → tries hardcoded `WIFI_SSID`/`WIFI_PASSWORD` for 10s → falls back to `WiFiManager` captive portal (`AP_NAME="Xeno-Garden-Setup"`, `AP_PASSWORD="admin123"`) if that fails, so the device is field-recoverable without reflashing.

**Main loop (non-blocking, `millis()`-based, no `delay()` in the hot path):**
- Every `PUMP_CHECK_INTERVAL` (300ms): `checkPumpCommand()` — fast GET poll described in §3B.
- Every `SEND_INTERVAL` (1000ms): read all sensors, print a formatted Serial Monitor report, `sendToBackend()`.
- If WiFi drops, attempts `WiFi.reconnect()` every loop iteration with a 3s delay and skips the rest of that loop pass.

**Soil moisture reading — ⚠️ CRITICAL HACK TO REMOVE ON REBUILD:**
```cpp
float readSoilMoisture(int* rawOut) {
  ... averages 10 analogReads, maps SOIL_DRY_VALUE(0)..SOIL_WET_VALUE(4095) to 0..100 ...
  moisture = 0.0;   // "EMERGENCY PRESENTATION BYPASS" — hardcoded, real reading discarded!
  return moisture;
}
```
This function computes a real calibrated moisture value and then **throws it away**, always returning `0.0`, purely so that during the live demo/presentation the auto-mode pump would reliably trigger ON. **This means the deployed firmware's soil sensor is completely non-functional** — the actual moisture sensor is wired up and read but its value is discarded. This must NOT be carried into a rebuild; it was a one-off demo hack (see commit `7065555 "Final presentation configuration: ... moisture bypass"`).

**Calibration constants are also effectively disabled:** `SOIL_DRY_VALUE=0`, `SOIL_WET_VALUE=4095` (i.e., raw ADC value == percentage 1:1, no real calibration was ever done against actual air/water readings, unlike what `HARDWARE_BUILD_GUIDE.txt` instructs).

**Networking:** `HTTPClient` synchronous calls (blocks the loop for the duration of each HTTP request — up to 5s timeout on POST, 2s on GET). JSON via `ArduinoJson` v7 (`JsonDocument`, not the older `StaticJsonDocument`). WiFi credentials and server IP are **hardcoded in `config.h`** and committed to git (SSID "WOU_SMgmt", a university WiFi network) — a real secret is checked into version control.

**pH sensor:** wiring guides and `HARDWARE_BUILD_GUIDE.txt` still describe a pH sensor on GPIO35, but it was fully removed from `firmware.ino`, `config.h`, and the backend in commit `6a246c9 "Remove pH sensor from entire stack"`. Documentation is stale.

---

## 7. Mobile App State Management (`AppContext.js`)

Single global Context (`AppContext`) holds:
- `sensorData` (object with `soil_moisture, temperature, humidity, rain_status, pump_status`), `history` (array), `alerts` (array), `loading`, `error`, `deviceId` (default `"esp32-field-01"`, hardcoded in both mobile and firmware config so they must be kept in sync manually), `connectionStatus` (`connecting|online|offline`), `thresholds` (`{moistureLow:30, moistureHigh:40, temperatureHigh:30}` — **local UI state only, never sent to the backend** — see §10 bug).
- Actions: `refreshSensorData`, `refreshHistory(limit)`, `refreshAlerts`, `togglePump(action)`, `toggleAutoMode(bool)` — all thin wrappers around `apiService.js` functions that update local state and rethrow on failure (callers catch to set `error`).

No Redux/Zustand/React Query — plain `useState`/`useCallback`/`createContext`. No persistence (AsyncStorage) — device ID and thresholds reset to defaults on every app restart.

---

## 8. Mobile Screens — Behavior Detail

- **DashboardScreen**: polls `refreshSensorData` on a **1-second** interval (`config.DASHBOARD_REFRESH`, despite README claiming "every 10s" — code and docs disagree, code wins). 2×2 `SensorCard` grid (Soil Moisture, Temperature, Humidity, Rain). Auto/Manual `Switch` does optimistic UI update with rollback on API failure. `PumpToggle` circular button below it. Full-screen "Server Unreachable" state when `connectionStatus === "offline"` and there's no cached data — has a bug: it renders a fake "TRY AGAIN" button by nesting a `View` inside a `RefreshControl` (which is not how `RefreshControl` is meant to be used — it's designed to wrap a scrollable, not act as a tap target; this likely does not work reliably, see §10).
- **HistoryScreen**: fetches `history` via `refreshHistory(limit)` where limit is 48 ("24H" filter) or 200 ("7 Days" filter) — this is a **row-count limit, not an actual time-window filter**; if the device posts faster/slower than assumed, the labels are wrong. Charts only ever render the **last 20 points** of whatever was fetched (`chartData = [...history].reverse().slice(-20)`), so the "7 Days" filter with 200 rows still only visually shows the most recent 20 readings — the filter mostly doesn't change what's visible.
- **AlertsScreen**: simple list + pull-to-refresh + empty state. No resolve action wired up.
- **SettingsScreen**: edits `thresholds` and `deviceId` in Context only — **never calls any backend endpoint**, so changing "Moisture Low" here has **zero effect** on the actual automation running server-side (which reads thresholds from the backend's own `.env`). This is a significant functional gap presented to the user as if it works.

---

## 9. Tech Stack & Versions (for parity/upgrade planning)

- **Backend**: Node.js (CommonJS), Express **5.2.1** (major-version 5, not 4 — different error-handling semantics for async routes), Mongoose **9.2.3**, express-validator 7.3.1, helmet 8, morgan 1.10, dotenv 17, cors 2.8.
- **Mobile**: Expo **54**, React **19.1.0**, React Native **0.81.5**, @react-navigation/native + bottom-tabs **v7**, axios 1.13.6, react-native-chart-kit 6.12, react-native-svg 15.12, @expo/vector-icons 15.1, react-native-safe-area-context 5.6, react-native-screens 4.16. `qrcode` package is listed as a dependency but is not imported anywhere in `src/` — dead dependency.
- **Firmware**: Arduino/C++ on ESP32 (Arduino-ESP32 core), libraries: `WiFi.h`, `HTTPClient.h`, `ArduinoJson` (v7 API), `DHT sensor library` (Adafruit) + `Adafruit Unified Sensor`, `WiFiManager` (tzapu).
- **Database**: MongoDB, no Atlas config present — `.env` points at `mongodb://localhost:27017/irrigation_db`, i.e. local-only for this deployment despite the presentation outline describing an "Atlas cloud migration" as future work.

---

## 10. Known Bugs / Tech Debt / Stale Docs (be deliberate about NOT repeating these in a rebuild)

1. **Moisture sensor is hardcoded to return 0.0** in firmware (`moisture = 0.0;` "presentation bypass") — the real sensor value is computed then discarded. Must be removed.
2. **Settings screen thresholds are decorative** — they're stored in mobile Context only and never sent to/read by the backend; the backend automation always uses its own `.env` values (`MOISTURE_THRESHOLD_LOW/HIGH`). A rebuild should either make thresholds a real per-device backend setting, or remove the illusion of configurability.
3. **Temperature threshold is documented but not implemented.** `TEMPERATURE_THRESHOLD` env var exists and is shown in Settings UI, but `automationService.js` never reads temperature at all for the pump decision.
4. **pH sensor removed but not cleaned up**: `SensorReading.ph_level` field, `AlertLog` `PH_ALERT` enum value + red UI color mapping, and `PH_ALERT_THRESHOLD` env var all still exist with zero code path that ever sets them. Stale hardware docs (`HARDWARE_BUILD_GUIDE.txt`) still show a pH sensor on GPIO35.
5. **`LOW_MOISTURE` alerts have no de-duplication/debounce** — while moisture stays under threshold, a near-identical alert row is inserted on every sensor POST (every ~1s), unbounded growth of `AlertLog`.
6. **No authentication anywhere** — any client that can reach the backend's IP:port can inject fake sensor readings or toggle the real pump. Fine for a closed LAN demo, unacceptable for anything beyond that.
7. **CORS defaults to `*`**, `.env` ships `CORS_ORIGIN=*` — should be tightened for any real deployment.
8. **Hardcoded network config committed to git**: WiFi SSID/password in `esp32/firmware/config.h`, a specific developer's LAN IP in both `config.h` (`SERVER_URL`) and `mobile/src/config/api.js` (`API_BASE_URL`) — the app breaks the instant it's used on a different network; both files require manual editing + rebuild/redeploy per environment. No `.env`-driven config for the mobile app or firmware.
9. **`manualOverrideUntil` field is written but never read** — the intent (a 5-minute manual-override window before automation can retake control) is not enforced anywhere; `evaluateAutomation` doesn't check it. Currently the *only* thing that keeps automation from instantly overriding a manual command is the `autoMode` boolean master switch.
10. **`Device.pumpStatus` race-condition history**: multiple past commits (`4a4a647`, `c304391`, `c059b1e`) fixed races between the ESP32's 1s sensor POST and the mobile app's manual toggle by switching to atomic `findOneAndUpdate`. The current code is correct on this specific point, but it's evidence the architecture (two independent writers racing to set the same field, reconciled only by "last write wins" + atomic updates) is fragile — a proper command/state separation (e.g., `desiredPumpState` vs `actualPumpState`, or a queue) would be more robust.
11. **HistoryScreen's "24H"/"7 Days" filters are really just different row-count limits** (48 vs 200), not real date-range queries, and the chart always truncates to the last 20 points regardless — so the two filters look nearly identical in the UI most of the time.
12. **Dashboard's offline "TRY AGAIN" button is a `View` with `onTouchEnd` nested inside a `RefreshControl`** — not a standard/reliable pattern; `RefreshControl` is meant to wrap a `ScrollView`, not act as a button container.
13. **No tests anywhere** (backend `npm test` is a stub `echo "Error: no test specified"`; mobile has zero test files).
14. **Stray files committed**: `backend/out.txt`, `backend/out2.txt` (raw log dumps), unused `qrcode` npm dependency in mobile.
15. **Docs (README, old `claude_context.md`) describe temperature-gated pump-ON and pH alerts that don't exist in code** — documentation drifted from implementation as pH was removed and thresholds were simplified.
16. **Alert resolve endpoint (`PATCH /api/alerts/:id/resolve`) has no UI entry point** — dead API from the mobile app's perspective.
17. **10-second vs 1-second refresh discrepancy** between README ("auto-refresh every 10s") and actual code (`DASHBOARD_REFRESH: 1000`).
18. **Synchronous blocking HTTP calls on the ESP32** (`HTTPClient` used synchronously in the main loop) — a slow/unreachable server stalls sensor reading and relay polling for up to the timeout duration (5s on POST). No AsyncHTTP.

---

## 11. Git History Highlights (chronological, oldest → newest) — shows how the project actually evolved

1. `ef46ba6` — initial backend + mobile app scaffold.
2. `8ea7e53` — README.
3. `888c79c` — initial ESP32 firmware, `config.h` pattern established.
4. `11ac567` — hardware build guide (BOM, wiring, calibration) written **before** hardware was finalized (still references pH sensor).
5. `0d46aa1` — full React Native app added (dashboard/alerts/history/settings/nav/services) in one commit.
6. `9c5c26e` — ESP8266 alternate wiring guide added (a road not taken — final build used ESP32).
7. `fd2e913` — "Premium UI redesign" — the current dark violet/emerald glassmorphism theme replaced an earlier design.
8. `6a246c9` — **pH sensor removed entirely** from firmware/backend (docs never fully updated after this).
9. `e4ebfb4`, `df88e71` — firmware rewritten for correct ESP32 ADC (12-bit) and libraries; relay removed then pins reshuffled (GPIO34 soil, GPIO27 rain); refresh rate set to 1s.
10. `1e49631`, `ceada08` — networking/WiFi config iterated for "LTE access" and GPIO5 relay experiments.
11. `acba667` — manual-only pump control + WiFiManager captive-portal fallback added (robustness for field demo, no reflash needed to change WiFi).
12. `20e4532` — server IP + HTTP timeout tuning.
13. `4a4a647` — **race condition fix**: atomic `findOneAndUpdate` for pump state to stop sensor POSTs from clobbering manual commands.
14. `c059b1e`, `c304391` — IP updated again to `192.168.0.102`, pump-OFF race/delay fixed further, relay migrated to **GPIO 26** (final pin).
15. `bd4c870` — local dev IPs/WiFi credentials committed for a specific test environment.
16. `e4187b2` — "Finalize working pump automation, UI toggle, and stable firmware" — considered feature-complete for demo.
17. `7065555` (HEAD) — **"Final presentation configuration: University WiFi, new IP, and moisture bypass"** — the moisture-hardcoded-to-0 hack (§6) was added at the very last commit, specifically to guarantee the auto-pump would trigger live during a graded/judged presentation. **This is the current state of `main`.**

**Reading between the lines:** this was built and iterated rapidly for a specific one-time demo/presentation deadline, with several "make it work for the demo" shortcuts landing in the final commits (hardcoded moisture, hardcoded WiFi/IP, no cleanup of removed pH feature). A rebuild should treat the *architecture and feature set* as the reference, but explicitly discard the demo-day hacks in §10.

---

## 12. Hardware Reference (for anyone re-wiring / re-speccing)

**Final ESP32 build (what `firmware.ino`/`config.h` actually implement):**
| Component | ESP32 Pin | Notes |
|---|---|---|
| DHT11 (temp+humidity) | GPIO4 | 3.3V logic |
| Soil moisture (analog, capacitive) | GPIO34 | 12-bit ADC, 11dB attenuation, 10-sample average — **but result is discarded and forced to 0.0**, see §6 |
| Rain sensor (digital) | GPIO27 | `INPUT_PULLUP`, LOW = rain |
| Relay → 12V pump | GPIO26 | Active-LOW module (`LOW`=ON, `HIGH`=OFF); relay NO contact wired in series with pump's 12V supply, ESP32 never carries pump current directly |

**Power (per `pump_connection_guide.txt`, hybrid solar setup used for the final demo):** Solar panel → charge controller → battery; charge controller's regulated LOAD terminal feeds the pump (through the relay's NO contact) directly at battery voltage (12V); a separate buck converter steps battery voltage down to 5V/3.3V to power the ESP32 only. ESP32 and pump are electrically isolated except through the relay's switched contact.

**BOM total** (per `HARDWARE_BUILD_GUIDE.txt`, includes a pH sensor that was later dropped from the real build): ~₹2,000–3,200 (~$25–40).

Older/alternate docs in the repo (`ESP8266_CONNECTION_GUIDE.txt`) describe a different, never-shipped variant with a 16×2 I2C LCD on an ESP8266 — useful only as inspiration, not a description of the current system.

---

## 13. Suggested Priorities If Rebuilding

If the goal is "the same product, done properly," the highest-leverage fixes, roughly in order:
1. Remove the moisture-bypass hack; actually calibrate `SOIL_DRY_VALUE`/`SOIL_WET_VALUE` against real air/water readings.
2. Move all network config (WiFi creds, server URL, device ID) out of committed source — firmware via `WiFiManager`'s captive-portal config storage (it's already a dependency!) instead of `#define`s in `config.h`; mobile via a runtime-configurable setting (persisted in AsyncStorage) instead of a hardcoded `API_BASE_URL`.
3. Make Settings' thresholds real: either a `PUT /api/devices/:id/thresholds` endpoint the automation service actually reads per-device, or remove the fake UI.
4. Add authentication (at minimum a shared device API key header for ESP32 writes, and basic auth/JWT for the mobile app) plus a locked-down CORS origin — even a "local demo" project benefits from not being trivially spoofable.
5. Debounce `LOW_MOISTURE` alert creation (e.g., only create a new alert if the previous unresolved one for that device is older than N minutes, or use upsert-and-bump-count semantics).
6. Decide pH's fate: either re-add it end-to-end (sensor → firmware → backend → alerts → UI) or delete every remaining trace (`ph_level` field, `PH_ALERT` enum/UI color, `PH_ALERT_THRESHOLD` env var, stale hardware docs).
7. Replace the dual-poll pattern (1s POST + 300ms GET) with a single bidirectional channel — WebSocket or MQTT — for lower latency and less constant HTTP overhead; the presentation outline itself flags MQTT as a "future direction."
8. Make History's time filters real (server-side date-range queries) and stop truncating the chart to a fixed last-20-points regardless of filter.
9. Add tests (at least for `automationService.evaluateAutomation`, since it's the core business logic and is currently untested) and wire up CI.
10. Clean up stray committed files (`out.txt`, `out2.txt`) and unused deps (`qrcode`).
