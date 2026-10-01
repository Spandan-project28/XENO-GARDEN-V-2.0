# Xeno Garden v2 — Master Implementation Plan

> **This is the single source of truth for the rebuild.** Every loop iteration starts by reading this file,
> picks the next unchecked task, completes it, verifies it, checks it off, and logs it.
> **v2.1:** §15 Simple Mode and Phase 10 take priority where they conflict with earlier sections.
> Background on v1 (what it did and what went wrong) lives in `claude_context.md`. Read it once per session; do not copy its bugs.

---

## 0. Loop Protocol (read this first, every iteration)

Each iteration does **exactly one task** (one `- [ ]` line in §12) unless the task is trivially small, in which case finish its whole group.

1. **Orient.** Read this file, then read the last ~40 lines of `docs/PROGRESS.md`. Find the first unchecked `- [ ]` task in §12 whose phase isn't blocked.
2. **Check dependencies.** If the task needs something marked `🧑 HUMAN`, skip it: mark it `- [~] BLOCKED (reason)` and move to the next task that isn't blocked. Never make up credentials, URLs or account IDs.
3. **Implement** the task, following §3 (architecture), §10 (conventions) and the contracts in §5–§7. If you need to break a contract, update the contract section in this file first, then the code.
4. **Verify.** Run the checks listed in §11 for the parts you touched (typecheck, lint, tests, simulator). A task isn't done until they pass. If they fail, fix them. If you can't fix it within the iteration, leave the task unchecked and log why.
5. **Record.**
   - Tick the box `- [x]` in §12.
   - Add an entry to `docs/PROGRESS.md`: date, task ID, what changed, how it was verified, any follow-ups.
   - For a non-obvious design decision, add an ADR line to §13.
6. **Never regress.** If a previously passing check now fails, fixing it becomes the current task.
7. **Completion.** When every task in §12 is `[x]` or `[~] BLOCKED` on human input only, print the list of blocked items with exact instructions for the human, then output `<promise>XENO_V2_COMPLETE</promise>`.

**Hard rules:**
- Never commit secrets: no WiFi passwords, JWT secrets or broker passwords in source. Only `.env.example` with placeholders.
- Never hardcode an IP address or hostname anywhere in app or firmware code.
- No demo hacks like v1's `moisture = 0.0` bypass. Real data only. For demos, use the simulator (§8).
- Don't delete or rewrite `claude_context.md` or this plan's §0–§11 unless a task explicitly says so.
- If git is initialised, commit after each verified task: `feat(scope): …` / `fix(scope): …`, with the attribution trailer.

---

## 1. Product Vision

A real consumer-grade smart irrigation product:

- **Zero network configuration by the user.** No IP addresses, ever. The phone app works on any internet connection (home WiFi, college WiFi, 4G/5G). The device joins WiFi through **in-app Bluetooth pairing**, remembers several networks, and switches between them automatically.
- **Setup in about 60 seconds** (v2.1 Simple Mode, §15, removes the sign-up step and finds devices automatically). Originally: open the app → sign up → "Add device" → the app finds the ESP32 over BLE → pick a WiFi network and enter its password → the device appears live on the dashboard.
- **Safe by default.** The device runs its automation locally, so it keeps working when the internet or server is down. It has a hard maximum pump runtime and rain lockout. When it loses connection, the pump fails safe to OFF.
- **Stunning, modern UI.** Light and dark themes, smooth animations, live updates with no manual refresh, and charts over real time ranges.
- **Built to change.**
  - The UI is built from a token-driven design system and reusable components.
  - Features are self-contained modules.
  - Plant-health ML plugs in through a defined interface without rewrites.

---

## 2. Why v1 failed on connectivity, and the v2 fix

| v1 problem | Root cause | v2 solution |
|---|---|---|
| Must type the server IP into app and firmware | Backend lived on a laptop's LAN IP, which changes with every network | **Backend and message broker hosted in the cloud** at fixed public hostnames (TLS). Hostnames are baked into build config, never typed by the user. |
| Phone only works on the same WiFi as the laptop | LAN-only HTTP | The phone talks to the cloud API over HTTPS/WSS, so it works on any network. |
| WiFi credentials hardcoded in `config.h` | No provisioning flow | **BLE provisioning from the app**. The ESP32 stores up to 5 networks in NVS and roams between them. A "Change WiFi" button in the app can re-provision at any time. |
| "Still no guarantee it connects" | Single SSID try plus captive portal, no feedback | The device reports connection progress over BLE during setup (connecting / wrong password / no internet / connected to cloud), and the app shows each step. After setup, the device keeps retrying all saved networks with backoff. |
| 1 s POST + 300 ms GET polling, races on `pumpStatus` | HTTP polling with two writers to the same field | **MQTT** (persistent, bidirectional, instant) with a **desired / reported state** ("device shadow") model. There is exactly one writer per field. |

---

## 3. System Architecture

```
┌──────────────────┐   MQTT over TLS (8883)    ┌─────────────────────┐
│ ESP32 firmware   │ ─────────────────────────►│ MQTT broker (cloud) │
│ • sensors        │ ◄─────────────────────────│  managed / Mosquitto│
│ • local autom.   │   desired state, cmds     └─────────┬───────────┘
│ • BLE provision  │                                     │ MQTT (subscriber)
└───────▲──────────┘                                     ▼
        │ BLE (setup only)                 ┌──────────────────────────────┐
        │                                  │ Backend API (Node + TS)      │
┌───────┴──────────┐   HTTPS REST + WSS    │ • REST (Fastify)             │
│ Mobile app       │ ◄────────────────────►│ • Realtime gateway (WS)      │
│ (Expo, TS)       │   live updates        │ • Device shadow service      │
└──────────────────┘                       │ • Alerts / notifications     │
                                           │ • Insights (ML plugin port)  │
                                           └───────┬──────────────┬───────┘
                                                   ▼              ▼
                                            MongoDB Atlas   ML service (Python,
                                          (time-series +    FastAPI) — later,
                                            documents)      behind an interface
```

### Key design decisions
1. **The device owns its automation.** Thresholds and settings are stored in the cloud and pushed to the device as *desired config*. The ESP32 evaluates the rules locally every sensor tick. This means the pump behaves correctly even offline, and there are no network round-trip races.
2. **Device shadow.** For each device the backend stores:
   - `desired`: what the user or cloud wants, e.g. mode, manual pump command with expiry, thresholds.
   - `reported`: what the device says is actually happening.

   Only the app/cloud writes `desired`. Only the device writes `reported`. The UI shows `reported` and shows "pending…" while `desired ≠ reported`.
3. **Commands carry an ID and an expiry.** A manual "pump ON for 10 minutes" is sent as `{cmdId, action, durationSec, expiresAt}`. The device acknowledges it and switches itself off at expiry. This replaces v1's unused `manualOverrideUntil`.
4. **Realtime to the app:** the backend relays MQTT events to app clients over a WebSocket (Socket.IO). The app never talks to MQTT directly. That keeps broker credentials off phones, and the backend stays the authorisation point.
5. **Every hostname comes from environment config.**
   - The app gets `EXPO_PUBLIC_API_URL` at build time.
   - The firmware gets `BROKER_HOST` at build time, from `platformio.ini` build flags that come from a git-ignored `secrets.ini`.
   - Dev, staging and prod differ only in config.
6. **ML is a port, not a feature.** The backend defines a `PlantHealthProvider` interface. v2 ships a `RuleBasedHealthProvider`, which scores from sensor trends. A later `MlHealthProvider` calls the Python service. The app renders whatever `HealthReport` it gets.

---

## 4. Tech Stack (decided — don't re-litigate without an ADR)

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | npm workspaces + Turborepo | Shared types; Expo supports monorepos natively |
| Language | **TypeScript everywhere** (strict) | Safe refactors for future changes |
| Shared contracts | `packages/shared`: **Zod** schemas + inferred types | One definition used by backend validation, app forms and MQTT payloads |
| Backend | Node 22 LTS, **Fastify 5**, `fastify-type-provider-zod`, `@fastify/swagger` | Fast, schema-first, generates OpenAPI docs for free |
| DB | **MongoDB** (Atlas in prod, Docker locally) + Mongoose 8+ | Continuity with v1; native **time-series collections** for readings |
| Realtime (device) | **MQTT 3.1.1/5** — `mqtt.js` in backend, `aedes` in-process broker for tests, Mosquitto in docker-compose for local dev, managed broker (EMQX Cloud Serverless or HiveMQ Cloud) in prod | Industry standard for IoT; ESP32-native |
| Realtime (app) | **Socket.IO** | Auto-reconnect, rooms per device, works through mobile networks |
| Auth | Email + password (argon2) → JWT access token (15 min) + rotating refresh token (30 d); device credentials issued at claim time | Real accounts; lets multiple devices belong to one user |
| Push notifications | `expo-notifications` + Expo Push API | Alerts reach the phone even when the app is closed |
| Mobile | **Expo (latest stable SDK)**, **Expo Router** (file-based), React Native New Architecture | Modern, easy to add screens |
| Mobile state | **TanStack Query** (server state) + **Zustand** (client/UI state) + `expo-secure-store` (tokens) + MMKV (prefs) | Caching, retries and offline cache handled properly |
| Mobile UI | Own design system on **react-native-reanimated**, **react-native-gesture-handler**, **expo-blur**, **expo-linear-gradient**, **@shopify/react-native-skia** + **victory-native** (charts), **lucide-react-native** icons, **expo-haptics** | Premium feel; the UI is fully swappable through tokens |
| BLE | `react-native-ble-plx` (needs an **Expo dev build**, not Expo Go) | Required for provisioning |
| Firmware | ESP32, **PlatformIO** + Arduino framework; `NimBLE-Arduino` (BLE), `PubSubClient` or `esp-mqtt` via Arduino (MQTT/TLS), `ArduinoJson` v7, `DHT sensor library`, `Preferences` (NVS) | Reproducible builds, library pinning |
| ML service (later) | Python 3.12, **FastAPI**, model served behind `/v1/health/predict` | Standard ML serving; swappable |
| Testing | Vitest (shared + backend), `mongodb-memory-server`, `aedes` (in-memory MQTT), Jest + React Native Testing Library (mobile), PlatformIO native unit tests (firmware logic) | Everything testable without hardware |
| Quality | ESLint (flat config), Prettier, `tsc --noEmit`, Husky + lint-staged (optional), GitHub Actions CI | |

---

## 5. Repository Layout (target)

```
xeno_rebuilt_1/
├── claude_context.md              v1 reference (read-only)
├── implementation_plan.md         THIS FILE
├── README.md                      Quick start (written in Phase 9)
├── package.json                   workspaces: apps/*, packages/*, tools/*
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml             mongo + mosquitto for local dev
├── docs/
│   ├── PROGRESS.md                loop log (append-only)
│   ├── ARCHITECTURE.md            diagrams + flows (kept in sync)
│   ├── API.md                     generated/linked OpenAPI summary
│   ├── MQTT.md                    topic + payload contract
│   ├── HARDWARE.md                final wiring (pH removed, pins verified)
│   └── ML_INTEGRATION.md          how to plug in a model
├── packages/
│   └── shared/                    Zod schemas, types, constants, topic builders, unit conversions
│       └── src/{schemas,types,mqtt,constants}/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── app.ts             Fastify factory (testable, no listen)
│   │   │   ├── server.ts          entry: config → db → mqtt → http → ws
│   │   │   ├── config/            env parsing via Zod (fail fast)
│   │   │   ├── plugins/           auth, db, mqtt, socket, swagger, rate-limit, cors
│   │   │   ├── modules/           ← feature modules, each self-contained
│   │   │   │   ├── auth/          routes, service, model, tests
│   │   │   │   ├── devices/       claim, list, rename, delete, shadow
│   │   │   │   ├── telemetry/     ingest (from MQTT), queries, rollups
│   │   │   │   ├── control/       pump commands, mode, settings → desired state
│   │   │   │   ├── alerts/        rules, dedup, ack/resolve
│   │   │   │   ├── notifications/ push tokens, Expo push sender
│   │   │   │   ├── plants/        plant profiles attached to devices
│   │   │   │   └── insights/      PlantHealthProvider port + rule-based impl
│   │   │   ├── realtime/          MQTT → Socket.IO bridge
│   │   │   └── lib/               logger (pino), errors, time utils
│   │   ├── test/
│   │   └── Dockerfile
│   ├── mobile/                    (Expo SDK 57 convention: routes live in src/app — ADR-012)
│   │   ├── src/app/               Expo Router routes (thin — only compose features)
│   │   │   ├── (auth)/            sign-in, sign-up
│   │   │   ├── (tabs)/            index(home), history, alerts, settings
│   │   │   ├── device/[id]/       detail, settings, wifi, plant, health
│   │   │   └── onboarding/        add-device BLE flow (multi-step)
│   │   └── src/
│   │       ├── design/            tokens, themes (light/dark), typography, motion presets
│   │       ├── ui/                primitives: Screen, Card, Text, Button, Switch, Gauge, Chip, Sheet, Skeleton, EmptyState, Toast…
│   │       ├── features/          each: api hooks, components, store slice
│   │       │   ├── auth/ devices/ telemetry/ control/ alerts/ provisioning/ insights/ settings/
│   │       ├── components/        app-level composites that may use lib + ui (e.g. ConnectionBanner)
│   │       ├── lib/               api client, session, socket client, query client, storage, ble
│   │       └── config/            env (EXPO_PUBLIC_*), feature flags
│   └── simulator/                 Node CLI: fake ESP32(s) speaking the real MQTT contract
├── firmware/
│   ├── platformio.ini
│   ├── secrets.ini.example        BROKER_HOST, etc. (real secrets.ini git-ignored)
│   ├── include/                   config.h (pins/constants only, NO network secrets)
│   ├── src/
│   │   ├── main.cpp               setup/loop orchestration only
│   │   ├── sensors/               soil, dht, rain (each: read + calibrate + validate)
│   │   ├── actuators/pump.*       relay, failsafe, max-runtime watchdog
│   │   ├── automation/            pure-logic rules engine (unit tested natively)
│   │   ├── net/wifi_manager.*     multi-SSID store (NVS) + roaming + backoff
│   │   ├── net/mqtt_client.*      TLS, LWT, reconnect, topic handlers
│   │   ├── provisioning/ble.*     GATT service for WiFi + claim
│   │   └── state/shadow.*         desired/reported state, NVS persistence
│   └── test/                      native unit tests for automation + calibration
└── services/
    └── ml/                        (Phase 8) FastAPI stub with the predict contract
```

**Modularity rule:** a feature folder may import from `ui/`, `design/`, `lib/` and `packages/shared`, but **never from another feature's internals**. Anything shared goes up a level. This is what keeps the UI replaceable and new features cheap to add.

---

## 6. Data Model (MongoDB)

- **users**: `_id, email (unique, lowercased), passwordHash, name, createdAt, pushTokens[]`
- **refreshTokens**: `_id, userId, tokenHash, family, expiresAt, revokedAt` (TTL index on `expiresAt`)
- **devices**:
  ```
  _id, hardwareId (unique; ESP32 MAC-derived, e.g. "xg-3C71BF12AB34"),
  ownerId, name, plantId?, claimedAt,
  mqtt: { username, passwordHash },
  firmwareVersion, online, lastSeenAt,
  desired:  { mode: "auto"|"manual",
              manual: { pump: "ON"|"OFF", cmdId, expiresAt } | null,
              settings: { moistureLow, moistureHigh, maxPumpRunSec, cooldownSec,
                          rainLockout: bool, tempBoostC?: number, telemetryIntervalSec },
              version: int },
  reported: { mode, pump, pumpReason, settingsVersion, rssi, ssid, ip, uptimeSec, heapFree, at }
  ```
- **readings**: *time-series collection* `timeField: ts, metaField: deviceId, granularity: seconds`, with fields `soilMoisture, soilRaw, temperature, humidity, rain, pump`. TTL 30 days on raw data.
- **readings_hourly**: rollups (min/avg/max per metric, pump-on seconds) kept forever. Built by an aggregation job every hour, or on demand.
- **pumpEvents**: `deviceId, state, source: auto|manual|safety|schedule, reason, startedAt, endedAt, durationSec`
- **alerts**: `deviceId, type, severity, status: open|acknowledged|resolved, firstSeenAt, lastSeenAt, count, message, context{}`. There is a **partial unique index on `(deviceId, type)` where `status != resolved`**, so the same alert can't be open twice; repeats increment `count` instead.
  - Alert types: `LOW_MOISTURE`, `SENSOR_FAULT`, `DEVICE_OFFLINE`, `PUMP_MAX_RUNTIME`, `HIGH_TEMP`, `PLANT_HEALTH`.
- **plants**: `ownerId, name, species?, photoUrl?, targetMoisture?, notes`
- **healthReports**: `plantId, deviceId, provider: "rules"|"ml:<name>", modelVersion, score 0–100, status: healthy|attention|critical, findings[{code, message, confidence}], inputs{window, imageUrl?}, createdAt`

**Removed on purpose** (v1 leftovers): `ph_level`, `PH_ALERT`, `TEMPERATURE_THRESHOLD`-as-dead-config, `manualOverrideUntil`.

---

## 7. Contracts

### 7.1 MQTT topics (all under `xg/v1/`)

| Topic | Direction | Retained | QoS | Payload (Zod schema in `shared/mqtt`) |
|---|---|---|---|---|
| `xg/v1/{hwId}/telemetry` | device → cloud | no | 0 | `{ts, soilMoisture, soilRaw, temperature, humidity, rain, pump}` — every `telemetryIntervalSec` (default 5 s), plus immediately on pump change |
| `xg/v1/{hwId}/reported` | device → cloud | yes | 1 | reported shadow (see §6) — sent on change + every 60 s |
| `xg/v1/{hwId}/desired` | cloud → device | **yes** | 1 | full desired shadow `{version, mode, settings, manual}`; `manual` is the pump command `{cmdId, pump, durationSec, issuedAt, expiresAt}`. The device ignores versions ≤ the one it has applied (ADR-008) |
| `xg/v1/{hwId}/cmd` | cloud → device | no | 1 | `{cmdId, type: identify|reboot|pairing|calibrate_dry|calibrate_wet|factory_reset, issuedAt}` — non-pump one-shot commands |
| `xg/v1/{hwId}/cmd/ack` | device → cloud | no | 1 | `{cmdId, ok, error?}` |
| `xg/v1/{hwId}/status` | device → cloud (LWT) | yes | 1 | `"online"` / `"offline"` (the broker publishes `offline` if the device drops) |
| `xg/v1/{hwId}/event` | device → cloud | no | 1 | `{type: "sensor_fault"|"pump_max_runtime"|"boot"|"wifi_changed", data}` |

The broker ACL lets each device publish and subscribe only under its own `{hwId}`. The backend uses a service account with `xg/v1/#`.

### 7.2 REST API (`/v1`, JSON, JWT bearer unless noted)

```
POST   /v1/auth/register            {email, password, name}
POST   /v1/auth/login               → {accessToken, refreshToken, user}
POST   /v1/auth/refresh             rotate refresh token
POST   /v1/auth/logout
GET    /v1/me                       / PATCH /v1/me
POST   /v1/me/push-tokens           register Expo push token

POST   /v1/devices/claim            {hardwareId, claimCode} → {device, mqttCredentials}   (called by app during BLE onboarding)
GET    /v1/devices                  list mine (with shadow + latest reading)
GET    /v1/devices/:id              / PATCH (name, plantId) / DELETE (unclaim)
PUT    /v1/devices/:id/settings     partial settings; merged + re-validated → bumps desired.version (CAS), publishes desired
PUT    /v1/devices/:id/mode         {mode}
POST   /v1/devices/:id/pump         {action: "ON"|"OFF", durationSec?} → {cmdId, device}; sets desired.manual. UI shows pending until reported.manualCmdId === cmdId
POST   /v1/devices/:id/commands     {type: identify|reboot|pairing|calibrate_dry|calibrate_wet|factory_reset} → {cmdId} (device must be online)

GET    /v1/devices/:id/readings     ?from&to&resolution=raw|5m|1h|1d  (server picks rollup; real time ranges)
GET    /v1/devices/:id/readings/latest
GET    /v1/devices/:id/pump-events  ?from&to

GET    /v1/alerts                   ?deviceId&status&cursor
POST   /v1/alerts/:id/ack           / POST /v1/alerts/:id/resolve

CRUD   /v1/plants
GET    /v1/plants/:id/health        latest + history of HealthReports
POST   /v1/plants/:id/health/run    trigger evaluation (rules now, ML later)
POST   /v1/plants/:id/photos        (Phase 8: multipart image → storage → ML)

GET    /v1/health                   (public) liveness + db/mqtt status
GET    /docs                        (public in dev) Swagger UI
```

Errors always use this shape: `{error: {code, message, details?}}`. Lists use cursor pagination.

### 7.3 Socket.IO (namespace `/rt`, JWT in handshake auth)
- Client → `subscribe {deviceId}` (the server checks ownership) → joins room `device:{id}`.
- Server → `telemetry`, `shadow` (reported/desired changes), `status` (online/offline), `alert`, `cmd_ack`.

### 7.4 BLE provisioning GATT (firmware ↔ app)
- The device advertises the name `XenoGarden-XXXX` (last 4 hex digits of its MAC) and the service UUID `XG_PROV_SERVICE` (fixed, defined in `shared/constants` and `firmware/include`).
- Characteristics:
  - `info` (read): `{hwId, fwVersion, claimCode}`.
  - `wifi_scan` (write to trigger, notify results): list of `{ssid, rssi, secure}`.
  - `wifi_creds` (write): `{ssid, password}`, stored at the top of the NVS network list.
  - `cloud_creds` (write): `{host, port, tls, username, password}` taken from the claim response (ADR-009). A compiled-in default host is only a fallback.
  - `state` (notify): `idle|connecting_wifi|wifi_failed:<reason>|connecting_cloud|cloud_failed|online`.
- Setup is only allowed while in pairing mode:
  - on first boot;
  - after holding the BOOT button for 5 s;
  - for 2 minutes after the app sends "enter pairing" over MQTT.
- The claim code is random, generated at first boot and stored in NVS. The app reads it over BLE, so only someone physically near the device can claim it.
- MVP accepts the BLE link-layer risk (setup only, short window). Add the ESP BLE security/bonding task in Phase 9.

---

## 8. Simulator (the key to testing without hardware)

`apps/simulator`: `npm run sim -- --devices 2 --scenario drying`
- It speaks the **exact** MQTT contract (§7.1) with real device credentials, so the backend can't tell the difference.
- Scenarios: `steady`, `drying` (moisture falls → auto pump → recovers), `rain`, `sensor_fault`, `flaky_network` (random disconnects), `offline`.
- It includes a TypeScript port of the firmware automation rules, **tested against the same test vectors** as the C++ firmware tests (JSON vectors in `packages/shared/test-vectors/automation.json`). That guarantees the simulator and the real device behave the same way.
- Used for: end-to-end tests in CI, UI development without hardware, and demos instead of hacks.

---

## 9. Mobile UX Spec

**Design language:** calm, botanical and premium. Deep green/charcoal dark theme and a soft off-white light theme, with one vivid accent colour. Generous spacing, rounded 20–28 px cards, subtle glass/blur on overlays, and meaningful motion using spring animations. Values count up and gauges fill smoothly, with haptics on actions. All colours, radii, spacing, font sizes and motion come from `src/design/tokens.ts`. **No hard-coded styling values in feature code.** A new theme should be just a new token file.

**Screens:**
1. **Welcome / Auth**: hero illustration, sign in, sign up, show-password toggle, inline validation (Zod schemas from `shared`).
2. **Home (tabs/index)**
   - Device cards, one per garden zone: plant name, big animated moisture ring gauge, temperature/humidity/rain chips, pump state and online dot.
   - Tap a card to open Device Detail.
   - Empty state: "Add your first device" CTA.
3. **Device Detail**
   - Live hero gauge.
   - Segmented **Auto / Manual** control.
   - Big pump button with a duration picker (5/10/15/30 min).
   - While `desired ≠ reported`, the button shows a "Starting…" state, then confirms with a haptic on ack.
   - Countdown ring while a manual run is active.
   - Mini 24 h sparkline, last pump event, device health (RSSI, SSID, firmware, uptime).
4. **History**: range chips (24 h / 7 d / 30 d / custom) that map to **real** `from/to` queries. Multi-series chart with a scrubbable tooltip; pump-on periods drawn as shaded bands; summary stats (average moisture, water-time total).
5. **Alerts**: grouped by day, severity colours, swipe to acknowledge/resolve, repeat count badge ("×37"), filter by status. Push notifications deep-link here.
6. **Plant Health (Insights)**
   - Score ring (0–100), status, findings list, trend.
   - "Run check" button.
   - Placeholder "Add photo" card behind a feature flag, for the future ML image model.
7. **Device Settings**: moisture low/high dual-thumb slider (validated low < high), max pump runtime, cooldown, rain lockout toggle, telemetry interval, rename, **Change WiFi** (BLE re-provision), identify, remove device.
8. **Add Device (onboarding)** — step wizard with progress:
   1. Explain the steps.
   2. Ask for Bluetooth and location permissions, with a clear explanation.
   3. Scan and list nearby `XenoGarden-XXXX` devices.
   4. Connect, then show the WiFi networks the *device* can see, with signal bars.
   5. Enter the password.
   6. Show live states streamed from the device: "Connecting to WiFi… Connecting to cloud… Online ✓", with specific, fixable error messages (wrong password, no internet on this WiFi, 5 GHz-only network — the ESP32 only supports 2.4 GHz).
   7. Name the plant.
   8. Done, with confetti.
9. **App Settings**: theme (system/light/dark), units (°C/°F), notifications on/off per alert type, account, sign out, about/version.

**UX rules:**
- Skeleton loaders, never spinners over blank screens.
- Offline banner when the phone has no internet; show the cached last-known data with "updated 3 min ago".
- Every destructive action asks for confirmation.
- Accessible: minimum 44 px touch targets, labels on all icons, dynamic type support, contrast ≥ 4.5:1 in both themes.

---

## 10. Engineering Conventions

- TypeScript `strict: true`. No `any` without a comment explaining why.
- Validate every external input with Zod: HTTP bodies, MQTT payloads, env vars, BLE payloads.
- Backend feature modules expose `register(app)`. Services are plain functions or classes that receive their dependencies, so they can be tested without Fastify.
- Structured logging with pino. No `console.log` in committed backend code.
- Firmware:
  - No `delay()` in the main loop; use millis-based schedulers.
  - Network calls must never block sensor reads or the pump watchdog.
  - All logic that can be pure (automation, calibration, JSON building) lives in files that compile for the `native` PlatformIO env and are unit tested there.
- Feature flags live in `apps/mobile/src/config/flags.ts` and `apps/backend/src/config/flags.ts`, e.g. `mlHealth`, `photoUpload`, `schedules`.
- Naming:
  - `camelCase` in JSON and TS.
  - MQTT payloads use the same field names as the Zod schemas.
  - The shared package owns every constant that crosses a boundary: UUIDs, topic templates, enums.
- Docs update in the same task as the behaviour change: `docs/MQTT.md`, `docs/API.md`, and this file's §6–§7.

---

## 11. Verification Commands

Run from the repo root unless noted. The loop uses whichever of these apply to the task.

| What | Command | Required for |
|---|---|---|
| Install | `npm install` | after any dependency change |
| Typecheck all | `npx turbo run typecheck` | every TS task |
| Lint | `npx turbo run lint` | every TS task |
| Unit tests | `npx turbo run test` | every task with logic |
| Backend integration | `npm -w apps/backend run test:int` (mongodb-memory-server + aedes, no docker needed) | backend tasks |
| End-to-end with sim | `npm -w apps/backend run test:e2e` (boots app + aedes + simulator scenario, asserts shadow/alerts) | Phase 5+ |
| Mobile bundle check | `npx -w apps/mobile expo export --platform android --output-dir .expo-export-check` (must succeed) and `npx -w apps/mobile expo-doctor` | mobile tasks |
| Mobile tests | `npm -w apps/mobile test` | mobile logic/components |
| Firmware logic tests | `py -3.14 firmware/test/run_native.py` (host C++ via `pip install ziglang`; ADR-014) | firmware logic tasks |
| Firmware build | `py -3.14 -m platformio run -e esp32dev -d firmware` (PlatformIO installed via pip) | firmware tasks |

UI screens get visual checks by a human on a device. The loop checks that the app compiles, has correct types, passes component tests, and uses tokens. It never claims visual approval.

---

## 12. Task Checklist (execute top to bottom)

Legend: `[ ]` todo · `[x]` done and verified · `[~] BLOCKED` · `🧑 HUMAN` = needs the user (accounts, hardware, secrets, physical testing)

### Phase 0 — Foundation
- [x] P0.1 Create the workspace: root `package.json` (workspaces), `turbo.json`, `tsconfig.base.json`, `.gitignore` (node_modules, .env, secrets.ini, build outputs), `.editorconfig`, Prettier and ESLint flat config.
- [x] P0.2 Create `docs/PROGRESS.md` (log template) and `docs/ARCHITECTURE.md` (copy of §3 plus sequence diagrams for onboarding, manual pump and auto cycle).
- [x] P0.3 `docker-compose.yml`: mongo:7 and eclipse-mosquitto:2 with a dev password file and ACL. Add `.env.example` for every app.
- [x] P0.4 `git init` and the first commit (only if git is available).

### Phase 1 — Shared contracts (`packages/shared`)
- [x] P1.1 Zod schemas: auth, device, shadow (desired/reported), settings (with the low < high refinement), reading, alert, pumpEvent, plant, healthReport. Export the inferred types.
- [x] P1.2 MQTT: topic builders/parsers for §7.1, plus a payload schema per topic.
- [x] P1.3 Constants: BLE UUIDs, default settings, alert types/severities, limits.
- [x] P1.4 `test-vectors/automation.json`: at least 25 cases covering the hold band, rain lockout, max runtime, cooldown, manual expiry, sensor fault and mode switching. Add a TS reference implementation `automation.ts` that passes all of them.
- [x] P1.5 Unit tests for everything above (100 % of the automation vectors).

### Phase 2 — Backend core
- [x] P2.1 Fastify app factory, Zod env config (fail fast with clear messages), pino, error handler (§7.2 error shape), `/v1/health`, Swagger, CORS allow-list from env, helmet, rate limiting.
- [x] P2.2 Mongo plugin plus all Mongoose models from §6, including the time-series collection, TTL, and the partial unique index on open alerts. Add index-creation tests.
- [x] P2.3 Auth module: register/login/refresh (rotation + reuse detection)/logout/me, argon2, JWT auth decorator. Integration tests.
- [x] P2.4 Devices module: claim (checks hwId + claim code, creates MQTT credentials), list/get/patch/delete, ownership guard on every `:id` route. Tests.

### Phase 3 — Realtime & device control
- [x] P3.1 MQTT plugin: connect with the service account, subscribe `xg/v1/+/{telemetry,reported,status,event,cmd/ack}`, validate payloads, route to services. Reconnect handling. Test with aedes.
- [x] P3.2 Telemetry ingest → `readings`. Update `devices.lastSeenAt/online`. Drop and log invalid payloads.
- [x] P3.3 Shadow service: settings/mode/pump endpoints write `desired` (with version bump) and publish it retained. The `reported` handler stores device state. Pump command → `cmd` topic with `cmdId` + `expiresAt`; the ack updates status.
- [x] P3.4 Pump events: derive start/stop records with source and reason from reported pump transitions.
- [x] P3.5 Socket.IO gateway: JWT handshake, `subscribe` with ownership check, fan out telemetry/shadow/status/alert/cmd_ack. Tests with socket.io-client.
- [x] P3.6 Readings query: `from/to/resolution`, automatically choosing raw / 5 m bucket / hourly rollup. Hourly rollup job. Tests with seeded data.

### Phase 4 — Alerts & notifications
- [x] P4.1 Alert engine: rules for LOW_MOISTURE (sustained for N minutes, not on every tick), SENSOR_FAULT, DEVICE_OFFLINE (LWT, or no telemetry for 3 × interval), PUMP_MAX_RUNTIME, HIGH_TEMP. Dedupe by upserting `count`/`lastSeenAt`. Auto-resolve when the condition clears.
- [x] P4.2 Alert routes: list (cursor), ack, resolve. Tests, including dedup under 1000 rapid events.
- [x] P4.3 Notifications: push-token registration, Expo push sender behind an interface (a fake in tests), per-user preferences, throttling (at most 1 push per alert per 30 min).

### Phase 5 — Simulator & end-to-end
- [x] P5.1 `apps/simulator` CLI: multiple devices, all scenarios from §8, using the shared automation implementation. It also responds to desired/cmd messages exactly as the firmware will.
- [x] P5.2 E2E test suite: register → claim a simulated device → receive telemetry over the socket → switch to manual → pump ON 1 min → ack → auto-expire → drying scenario produces exactly 1 deduped alert → device offline produces an alert.
- [x] P5.3 `npm run dev` at the root starts docker services, the backend in watch mode and 1 simulated device. Document it in the README.

### Phase 6 — Mobile app
- [x] P6.1 Expo app scaffold (TS, Expo Router, New Architecture), `EXPO_PUBLIC_API_URL` env config per profile (`development`/`preview`/`production` in `eas.json`), path aliases, Jest set up.
- [x] P6.2 Design system: tokens (colour/space/radius/type/motion/elevation), light + dark themes, a `useTheme` hook, and system/manual theme switching saved to storage.
- [x] P6.3 UI primitives in `src/ui/` (see §9), each with a basic render test.
- [x] P6.4 Core libraries: API client (fetch/axios + automatic refresh-token rotation + typed errors), TanStack Query client with persistence, Socket.IO client that joins device rooms and patches the query cache, secure token storage, NetInfo-based offline banner.
- [x] P6.5 Auth feature and screens, plus auth-gated routing.
- [x] P6.6 Home screen: device cards with live data and skeleton/empty states.
- [x] P6.7 Device Detail: gauge, mode switch, pump control with pending/ack/countdown states, device health.
- [x] P6.8 History: real range queries, a Skia/victory-native chart with pump bands, stats.
- [x] P6.9 Alerts: grouped list, swipe ack/resolve, filters, and deep links from push.
- [x] P6.10 Device Settings: validated form on the shared Zod schema, saving with optimistic UI, and a "syncing to device…" indicator until `reported.settingsVersion` matches.
- [x] P6.11 App Settings: theme, units, notification preferences, account.
- [x] P6.12 Push notification registration and handling (the permission flow plus a token POST).
- [x] P6.13 Onboarding (BLE provisioning wizard, §9.8) against a **mock BLE transport interface**, so the flow can be tested without hardware; the real `react-native-ble-plx` transport sits behind the same interface.
- [x] P6.14 Plant Health screen: consumes `/plants/:id/health`, with the photo card behind a feature flag.
- [~] BLOCKED (needs Expo account + phone) P6.15 🧑 HUMAN: create an Expo account, run `eas build --profile development --platform android`, install it on the phone, and point it at the local backend through a tunnel or the deployed backend.

### Phase 7 — Firmware (ESP32, PlatformIO)
- [x] P7.1 PlatformIO project: `esp32dev` and `native` envs, pinned library versions, `secrets.ini.example`, `config.h` with pins (GPIO4 DHT, GPIO34 soil, GPIO27 rain, GPIO26 relay active-LOW) and **no network secrets**.
- [x] P7.2 Sensors module:
  - Soil: 16-sample median-averaged ADC and a calibration struct `{dryRaw, wetRaw}` stored in NVS, with the **inverted-direction handling** (capacitive: higher raw = drier) auto-detected from calibration.
  - DHT: read at most every 2 s and reuse the last value between reads.
  - Rain: debounced.
  - Every sensor reports a validity flag, which drives the SENSOR_FAULT event.
- [x] P7.3 Automation module: a C++ port of the shared rules, passing `automation.json` vectors under `pio test -e native`.
- [x] P7.4 Pump actuator:
  - Relay off at boot before anything else.
  - Hard max-runtime watchdog, cooldown, and manual-command expiry.
  - Fail-safe OFF on sensor fault.
  - Fail-safe OFF if the cloud is lost while in manual mode (auto mode keeps working locally).
- [x] P7.5 WiFi manager:
  - Up to 5 saved networks in NVS.
  - Scans and connects to the strongest known one.
  - Exponential backoff.
  - Reports SSID/RSSI.
  - Never blocks the loop.
- [x] P7.6 MQTT client: TLS (root CA embedded via build flag), LWT on `status`, subscribe desired/cmd, publish telemetry/reported/event/ack, and an outbound buffer for the last N telemetry points while offline.
- [x] P7.7 Shadow state: apply desired with a version check, persist settings to NVS (so settings survive reboot and offline periods), publish reported on change.
- [x] P7.8 BLE provisioning service (§7.4) with NimBLE: pairing-mode rules, WiFi scan, creds, cloud creds, state notifications. The claim code is generated at first boot.
- [x] P7.9 Status LED patterns: pairing, connecting, online, error. BOOT-button long-press enters pairing mode, and a very long press does a factory reset.
- [x] P7.10 Optional stretch: OTA firmware update via an MQTT command pointing at an HTTPS URL.
- [~] BLOCKED (needs the physical board) P7.11 🧑 HUMAN: flash the board, run the in-app soil calibration (dry in air, then wet in water), and verify the relay polarity and the whole onboarding flow on real hardware.
- [x] P7.12 `docs/HARDWARE.md`: final wiring table, power (solar + buck + relay isolation from v1), calibration steps. pH removed.

### Phase 8 — Plant health / ML readiness
- [x] P8.1 Backend `insights` module: the `PlantHealthProvider` interface `{name, version, evaluate(input): Promise<HealthReport>}`, a provider registry chosen by env/flag, and the `RuleBasedHealthProvider` (moisture stability, watering frequency anomalies, heat stress from temperature/humidity trends). Scheduled daily evaluation plus an on-demand endpoint.
- [x] P8.2 `services/ml`: FastAPI stub (`/v1/health/predict` accepting `{plantId, species?, readingsSummary, imageUrl?}` and returning a `HealthReport`-compatible JSON), a Dockerfile, and a contract test shared with the backend's `MlHealthProvider` HTTP adapter (disabled by flag).
- [x] P8.3 Photo upload path behind the `photoUpload` flag: a pre-signed upload to object storage (interface first, with a local-disk implementation in dev).
- [x] P8.4 `docs/ML_INTEGRATION.md`: how to train or bring a model, the input/output contract, how to switch providers, and how to add a new health finding code to the app.

### Phase 9 — Hardening & deployment
- [x] P9.1 Security pass:
  - Rate limits on auth.
  - Account lockout/backoff.
  - Per-device broker ACL verified.
  - Input size limits.
  - Dependency audit.
  - BLE provisioning security (proof-of-possession using the claim code).
- [x] P9.2 Observability: request IDs, structured logs, a `/v1/health` deep check, and basic metrics (messages/s, connected devices).
- [x] P9.3 CI: GitHub Actions running typecheck, lint, tests, e2e (with aedes and mongodb-memory-server), the firmware native tests and the firmware build.
- [~] BLOCKED (needs cloud accounts + secrets) P9.4 🧑 HUMAN: create MongoDB Atlas (free M0) and a managed MQTT broker (EMQX Serverless or HiveMQ Cloud), and choose an **always-on** backend host (Railway / Fly.io / small VPS). Render's free tier sleeps and would drop the MQTT subscription, so it's not suitable. Put the secrets into the host's env.
- [x] P9.5 Deployment config: backend Dockerfile (multi-stage), a host config file (`fly.toml` or `railway.json`), and a production `EXPO_PUBLIC_API_URL` + firmware `BROKER_HOST` wired from config.
- [~] BLOCKED (needs deployed backend + phone + device) P9.6 🧑 HUMAN: deploy, run `eas build --profile production`, install, onboard the real device, and confirm it works on **home WiFi, a different WiFi, and mobile data** (this is the acceptance test for the core promise).
- [x] P9.7 README: quick start (dev with the simulator), architecture overview, and links to all docs.

### Phase 10 — Simple mode (v2.1: "open the app and it just works")
> Spec: §15. Keep the existing colour palette, typography and design tokens exactly as they are (the user approved them). Simplify *flows*, not the look.
- [x] P10.1 Shared contracts:
  - `POST /auth/guest` schemas; `userPublic.email` becomes nullable and gains `guest: boolean`; `upgradeBody` (email + password + name) for `POST /auth/upgrade`.
  - BLE `info` gains `mode: 'setup' | 'rejoin'`, and `claimCode` may be empty in rejoin mode (proto stays 1, with backward-compatible defaults).
  - `deviceNamePrefix` becomes `Xeno-`, plus a `defaultDeviceName(n)` helper → `Xeno 1`, `Xeno 2`, …
  - Tests.
- [x] P10.2 Backend guest accounts:
  - `POST /auth/guest` creates an account with no email or password and returns tokens. Rate limit: 5/min/IP.
  - `POST /auth/upgrade` attaches an email and password to the current guest account, keeping its devices.
  - The User model allows `email: null` (sparse unique index), and guests can't use `/auth/login`.
  - Claim assigns the default name `Xeno N`: the lowest free number among the owner's devices.
  - Integration tests; API.md + SECURITY.md updated.
- [x] P10.3 Mobile invisible session:
  - On first launch with no stored session, the app creates a guest session silently and opens straight to Home. No welcome or sign-in screens in the default path.
  - If the phone is offline on first launch, show a friendly retry screen in the same design language.
  - Settings → Account: "Save your garden" (upgrade to email) and "Sign in with email" (for a second phone). Sign-out of a guest account warns that its devices will be lost from this phone.
  - Tests.
- [x] P10.4 Mobile WiFi memory:
  - `wifiVault` keeps SSID → password in SecureStore, never in AsyncStorage or logs.
  - `currentPhoneWifi()` reads the phone's SSID via NetInfo (Android: location permission requested with a clear explanation; null on mobile data, iOS or no permission).
  - Tests.
- [x] P10.5 Mobile auto-setup engine (`features/setup/autoSetup.ts`, a pure state machine like `flow.ts`, tested with the mock transport):
  - **Discover:** scan for `Xeno-*` devices and name them `Xeno 1…n` in discovery order (the backend's default name wins after claim).
  - **Choose WiFi:** phone's current SSID if the device can see it → else the strongest network the device sees that's in the vault → else ask once (SSID prefilled; a picker of the networks the device sees). A password typed once is saved and reused for every other device.
  - **Each device, in sequence:**
    - setup mode: connect → info → claim → cloud creds → wifi creds → wait for `online` → confirm via API.
    - rejoin mode (already mine): connect → wifi creds → online.
  - **Failures:** a wrong saved password clears that vault entry and asks again once; other failures are per-device with "Retry", never blocking the other devices.
  - Tests cover 2 devices with zero prompts, the first-time prompt, a wrong password, a rejoin device, and a device that isn't mine in rejoin mode (skipped with a message).
- [x] P10.6 Mobile auto-setup UI:
  - Home auto-discovers nearby devices (when Bluetooth permission is already granted, or after one tap on "Find my devices") and shows a "2 Xeno devices nearby → Connect" card.
  - Connect opens a single sheet: one row per device with live step text and a progress ring, the one-time WiFi password field if needed, then a success state.
  - The empty Home state is a single big "Find my devices" action.
  - The old wizard stays reachable as "Set up manually".
  - Same tokens and colours. Component tests.
- [x] P10.7 Simpler everyday screens:
  - Home cards show moisture ring, status in plain words ("Soil is fine", "Watering…", "Needs water"), and one-tap **Water now** + **Auto** switch directly on the card.
  - Device detail keeps power features but leads with the same controls.
  - Plain-language copy everywhere; no jargon (RSSI → "Signal: Good").
  - Tests updated.
- [x] P10.8 Firmware simple-mode support:
  - BLE name `Xeno-XXXX`; `info.mode`.
  - **Rejoin mode:** when the device has saved networks but has been unable to join any of them for 2 min, it advertises in rejoin mode until it's online again. In rejoin mode it doesn't expose the claim code and rejects `cloud_creds`, accepting only `wifi_creds`. A stranger nearby can't take the device; the owner's app can give it new WiFi.
  - The pure policy lives in `xg_core` (`xg_pairing`) with native tests. ESP32 build passes.
- [x] P10.9 Demo parity: the mock BLE transport offers 2 simulated `Xeno-DEMO…` devices (plus a rejoin case) so the whole auto-setup can be exercised in Expo Go and in tests without hardware. Tests.
- [ ] P10.10 Local Android app build without an Expo account:
  - `tools/android/setup.ps1` downloads a portable JDK 17 and the Android SDK (cmdline-tools, platform, build-tools, NDK as required) into `%LOCALAPPDATA%\xeno-android` (outside the repo).
  - Adds `expo-dev-client`; `npm run android:apk` does `expo prebuild` + `gradlew assembleDebug` and copies the APK to `dist/xeno-garden-dev.apk`.
  - Verify the APK is produced. Document installing it (USB/adb or copying the file).
  - Generated `android/` stays git-ignored (CNG).
- [ ] P10.11 One-command cloud deploy:
  - `npm run deploy:cloud` (`tools/deploy.mjs`): checks `fly` login; creates app and volume if missing; generates JWT and metrics secrets; asks only for the MongoDB connection string; deploys; prints the URL and the exact `EXPO_PUBLIC_API_URL` / firmware CA steps.
  - Dry-run mode is tested.
  - DEPLOY.md updated.
- [ ] P10.12 Docs + full verification:
  - README "How to use (simple)", the §15 flows reflected in ARCHITECTURE.md, HARDWARE.md (rejoin LED), API.md, BLE docs.
  - Run every §11 command with no caches, and update PROGRESS.md.

### Definition of Done (whole project)
- A new user can install the app, sign up, add a device over BLE and see live data **without typing any IP address or editing any source file**.
- The phone app works on any internet connection. The device reconnects on its own after WiFi or router changes, and roams between saved networks.
- Auto irrigation works even when the server is unreachable. The pump can never run longer than `maxPumpRunSec`.
- Alerts are deduplicated and reach the phone as push notifications.
- History shows real time ranges.
- All automated checks in §11 pass. Every blocked item is only a human action, with clear instructions.
- Adding a new screen or feature only touches `app/<route>` + `src/features/<new>`. Swapping the UI theme only touches `src/design/`. Adding an ML model only touches `services/ml` + a provider registration.

---

## 13. Decision Log (ADR one-liners — append as you go)

- ADR-001: Cloud-hosted backend + MQTT broker instead of LAN server — the only way to get "works on any internet, no IPs".
- ADR-002: Automation runs on-device with cloud-managed settings — offline safety, no command races.
- ADR-003: Desired/reported shadow with versioning — one writer per field.
- ADR-004: BLE provisioning instead of a captive portal — native app UX, live error feedback, no phone WiFi switching.
- ADR-005: App gets realtime via backend Socket.IO, not direct MQTT — keeps broker credentials off phones, single authorisation point.
- ADR-006: Shared test vectors for automation across TS (simulator/backend) and C++ (firmware) — guaranteed identical behaviour.
- ADR-007: ML behind the `PlantHealthProvider` port, rule-based provider first — ships value now, zero rewrite later.
- ADR-008: Pump commands travel inside the retained, versioned `desired` shadow (`desired.manual`) rather than a fire-and-forget `cmd`. A device that reconnects still gets the command, and there is one mechanism for all state. `cmd` is kept for one-shot actions only. Acknowledgement = `reported.appliedVersion` / `reported.manualCmdId`.
- ADR-009: The claim response carries full broker connection info `{host, port, tls, username, password}`, and the app writes it to the device over BLE. The broker can move without reflashing firmware.
- ADR-011: Claim = register-or-transfer. The claim code is generated once at first boot and is only readable over BLE in pairing mode (physical access). The same owner can always re-claim. Another user needs a matching claim code. Every claim rotates the device's MQTT password. Other users' devices return 404, never 403.
- ADR-012: Mobile uses Expo SDK 57 conventions: routes in `src/app`, a JS tab navigator with a custom tab bar (from `expo-router/tabs`), AsyncStorage for prefs instead of MMKV so it works in Expo Go, custom SVG charts instead of victory-native/Skia (fewer native deps; the same look on every platform). The repo uses ESLint 9 because eslint-config-expo doesn't support ESLint 10 yet.
- ADR-013: BLE provisioning protocol v1 lives in `@xeno/shared/ble`. UTF-8 JSON payloads; writes are split into `i/n:chunk` frames of ≤160 bytes (fits the 185-byte iOS MTU, never splits multi-byte characters). Scan results and state arrive as small single-frame notifications. The app writes cloud credentials (from the claim) before WiFi credentials, so the device can go straight to `online`.
- ADR-014: Firmware logic lives in `firmware/lib/xg_core` (no Arduino headers) and is tested on the host with a small runner compiled by zig c++ (`pip install ziglang`), because PlatformIO's `native` platform needs a system gcc that Windows lacks. It runs the same `automation.json` vectors as the TypeScript engine. Safety-critical control runs in its own FreeRTOS task on core 1, so network I/O can never delay a pump cut-off.
- ADR-015: OTA uses a server-side release channel (env `FIRMWARE_LATEST_VERSION/URL/SHA256`). Clients can only say "update this device", never supply a URL. Devices verify the SHA-256 while streaming into the inactive slot before activating it. Secure boot and signing are left for high-assurance deployments.
- ADR-010: Manual commands work in any mode. In auto mode they are a temporary override (ON = water now, OFF = skip watering), then automation resumes. Max-runtime safety applies to every source. Rule order is in docs/ARCHITECTURE.md.

---

## 14. Human Inputs Needed (summary, filled in as they're hit)

| When | What the user must do | Why the loop can't |
|---|---|---|
| P6.15 | Expo account + dev build install on phone | Account and physical device |
| P7.11 | Flash ESP32, calibrate soil sensor, test relay | Physical hardware |
| P9.4 | Create Atlas + MQTT broker + backend host accounts, provide connection strings | Accounts, billing, secrets |
| P9.6 | Production build + real-world multi-network test | Physical device and networks |

Until those are done, everything is developed and verified against local Docker services, in-memory test infrastructure and the **simulator**. So nearly the whole project can be built and tested autonomously.

---

## 15. Simple Mode (v2.1) — the default experience

**Why:** the user's feedback was "real app ≠ complex app". The farmer or home gardener should never see accounts, IPs, broker settings or wizards with many steps. Everything powerful stays, but behind the scenes or one level deeper. **The colour palette, fonts and design tokens are approved and must not change.**

### The whole experience
1. **Install and open the app.** The phone can be on any internet: home WiFi, another WiFi or mobile data. A guest session is created silently; there's no sign-up. The app opens on **Garden**.
2. **Power on the ESP32s.** A new device starts in setup mode and advertises `Xeno-XXXX`.
3. **The app finds them.** "2 Xeno devices nearby → Connect". Android asks for Bluetooth/location permission the first time only, which the OS requires.
4. **Tap Connect.** For each device the app:
   1. claims it to this phone's account;
   2. gives it the cloud address and its own credentials;
   3. gives it WiFi credentials.

   The WiFi is the phone's current WiFi if the device can see it. Otherwise it's a network the app already knows, or else the user types the password **once**, with the network name already filled in. That password is remembered for every later device.
5. **Done.** The devices appear as **Xeno 1** and **Xeno 2** with live readings. Watering is automatic by default. "Water now" is one tap.
6. **Later, WiFi changes** (new router or password): the device can't join any saved network for 2 minutes, so it enters **rejoin mode** by itself. Next time the owner opens the app nearby, it shows "Xeno 1 needs WiFi → Fix" and fixes it with one tap, using a remembered password, or one prompt.

### Honest limits (state them in the UI copy, never hide them)
- **A WiFi password has to be entered once per network.** Neither Android nor iOS lets apps read saved WiFi passwords. After that, it's remembered.
- **Bluetooth setup needs the installed app** (P10.10 APK or an EAS build). Expo Go has no Bluetooth module, so in Expo Go the same flow runs with simulated devices (P10.9).
- **"Works on any internet" needs the server deployed to the cloud** (P10.11 + P9.4: accounts the human must create). Until then, phone, PC and devices must share a network.

### Security model in simple mode
- **Guest account:** a random account stored only in this phone's keychain, with the same JWT + refresh-rotation as before. Losing the phone means losing access, unless the user taps "Save your garden" (upgrade to email).
- **Claiming still requires the device's claim code,** which is only readable over the encrypted BLE link in setup mode. That's proof of physical possession, so a nearby stranger can't take a device that's already set up.
- **Rejoin mode** hides the claim code and refuses cloud credentials. The only thing someone nearby could do is point the device at a different WiFi, which takes it offline but can't take control of it. Automation keeps running offline, and the owner fixes it with one tap.
- **Saved WiFi passwords** live in SecureStore only (Keychain/Keystore), never in logs, the query cache or analytics.

### ADRs
- ADR-016: **Guest-first accounts.** Accounts exist for security and multi-phone sharing, not as a user-facing step. Upgrading to email is optional.
- ADR-017: **Auto-setup with a phone-side WiFi vault.** This is the closest thing to "connects to whatever internet I'm on" that the OS allows.
- ADR-018: **Device-initiated rejoin mode without a claim code.** It self-heals WiFi changes without reflashing and without opening a takeover path.
- ADR-019: **Local Gradle build of an Expo dev-client APK** (no EAS account needed for testing). The JS still comes from Metro, so no server address is baked in. Production builds still go through EAS with `EXPO_PUBLIC_API_URL`.
