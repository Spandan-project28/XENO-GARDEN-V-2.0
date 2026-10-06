# Xeno Garden v2

**Smart drip irrigation that just works.** An ESP32 waters your plants on its own, a cloud backend keeps history and sends alerts, and a mobile app lets you watch and control everything from anywhere.

No IP addresses, no sign-up, no reflashing to change WiFi, no "is my phone on the same network?".

## How to use it (simple mode)

1. **Install the app and open it.** There's no account to create; your garden opens straight away.
2. **Switch on your Xeno devices** near the phone. The app finds them by itself: *"2 new devices nearby → Connect"*.
3. **Tap Connect.** The app links them and gives them WiFi, using the phone's own network when the device can see it. At most you type the WiFi password once; every other device reuses it.
4. They appear as **Xeno 1**, **Xeno 2**, … with live readings. Watering is automatic; **Water now** and an **Auto** switch sit right on each card.
5. **New router or WiFi password later?** The device notices it can't connect and asks for new WiFi by itself. The app shows *"Xeno 1 needs WiFi → Fix WiFi"*.

Optional: Settings → **Save your garden** adds an email so you can open the same garden on another phone.

```
ESP32 ──MQTT/TLS──► broker ◄── backend (Fastify + Socket.IO) ──► MongoDB
  ▲                               ▲          │
  └── Bluetooth (setup) ── app ───┘ HTTPS    └──► ML service (optional)
```

## What's inside

| Folder | What it is | Tests |
|---|---|---|
| `packages/shared` | Contracts used everywhere: Zod schemas, MQTT topics, the BLE protocol, automation rules + golden test vectors | Vitest |
| `apps/backend` | REST API, embedded MQTT broker, device shadow, history, alerts, push notifications, plant health, signed photo storage, metrics | Vitest: unit, integration, end-to-end |
| `apps/simulator` | Fake ESP32s that use the real MQTT contract, for demos and tests without hardware | Vitest |
| `apps/mobile` | Expo SDK 57 app: auto-discovery and one-tap setup over Bluetooth, live dashboard, control, history charts, alerts, plant health, settings | Jest + Testing Library |
| `firmware` | ESP32 firmware (PlatformIO): pump safety task, multi-WiFi, MQTT shadow, encrypted BLE setup, self-healing rejoin mode | host C++ logic tests + ESP32 build |
| `tools/` | `npm run dev`, one-command cloud deploy, local Android app build | `node --test` |
| `services/ml` | FastAPI plant-health model service (baseline model, contract-tested) | pytest |
| `docs/` | Architecture, API, MQTT, hardware, deployment, security, ML integration, progress log | |

The build plan, and the source of truth for the whole project, is [`implementation_plan.md`](implementation_plan.md).

## Highlights

- **Zero network setup.** No sign-up (a private guest garden is created silently). The app finds nearby devices and gives them WiFi and cloud credentials over encrypted Bluetooth, typing a WiFi password at most once. Devices remember 5 networks, roam between them, and ask for new WiFi on their own when none works.
- **Safe by design.** The device runs automation itself, so it keeps watering offline. It has a hard maximum pump runtime, cooldown and rain lockout. It pauses on sensor faults. The pump is forced off at boot.
- **Honest UI.** Commands show "Starting…" until the device confirms. Settings show "Syncing to device…". Offline states are explained in plain words.
- **Real history.** Real time ranges (24 h → 90 d) with automatic rollups, pump sessions drawn on the chart, and a touch scrubber.
- **Alerts that aren't spam.** They're debounced, deduplicated (×37 instead of 37 alerts), cleared automatically, and pushed to your phone with a deep link.
- **Plant Scan (leaf disease detection).** Photograph a leaf: you get the condition, the confidence, treatment and prevention advice, plus tips from that garden's live sensors. Any model API plugs in through `apps/backend/.env` with no code changes. A local PlantVillage model is included. See [PLANT_SCAN.md](docs/PLANT_SCAN.md).
- **ML-ready.** Plant health uses a provider interface. The rule-based provider ships today, and a model service plugs in with one environment variable.
- **Built to change.** Every colour, size and animation comes from design tokens. Features are self-contained modules. Every contract is shared.

## Quick start (local, no Docker needed)

Requirements: Node ≥ 22.

```sh
npm install
npm run dev
```

`npm run dev`:

1. Starts a local MongoDB (bundled binary, data in `.data/`), or uses `$MONGO_URI`.
2. Starts the backend in watch mode with its embedded MQTT broker.
3. Detects your computer's LAN address, so the phone app and real devices on the same WiFi find it automatically.
4. Starts the simulator, plus its "virtual radio": in the app, **Find my devices** shows two demo devices (Xeno-DEM1/DEM2). Setting them up makes the simulator run them for real, with live data, all inside Expo Go. The simulator's own device belongs to **demo@xeno.garden / demo-garden-1**.

Then run the app: `cd apps/mobile && npx expo start` and open it in Expo Go.

**Real Bluetooth (real ESP32s)** needs the installable app. You can build it on this PC without any Expo account:

```sh
npm run android:setup        # once: portable Java + Android SDK (~3 GB, kept outside the repo)
npm run android:apk          # → dist/xeno-garden-dev.apk (development build; JS from `npx expo start --dev-client`)
```

**Works on any internet:** deploy the server (`npm run deploy:cloud -- --app <name>`), then build the finished app with `npm run android:apk -- --release --api https://<name>.fly.dev`. See [DEPLOY.md](docs/DEPLOY.md).

Options: `npm run dev -- --scenario drying --devices 3` (scenarios: `steady`, `drying`, `rain`, `sensor_fault`, `flaky_network`, `offline`). API docs: `http://localhost:4000/docs`.

## Tests

```sh
npm test                                   # unit tests, all packages
npm run test:int -w @xeno/backend          # integration: in-memory Mongo + MQTT
npm run test:e2e -w @xeno/backend          # whole system with a simulated device
npm run test:tools                         # deploy planner
python firmware/test/run_native.py         # firmware logic (pip install ziglang)
pio run -d firmware -e esp32dev            # build the firmware (pip install platformio)
cd services/ml && pytest                   # ML service contract
```

CI runs all of it (`.github/workflows/ci.yml`).

## Documentation

- [Architecture & flows](docs/ARCHITECTURE.md)
- [REST + realtime API](docs/API.md) · [MQTT contract](docs/MQTT.md)
- [Hardware & wiring](docs/HARDWARE.md)
- [Deployment](docs/DEPLOY.md)
- [Security](docs/SECURITY.md)
- [Plugging in an ML model](docs/ML_INTEGRATION.md)
- [Plant Scan: connect your disease model](docs/PLANT_SCAN.md)
- [Progress log](docs/PROGRESS.md)

## Configuration

Every setting comes from environment variables, validated at startup (`apps/backend/src/config/env.ts`). See `.env.example` and the table in [DEPLOY.md](docs/DEPLOY.md). No IP address, password or hostname is written in source code.
