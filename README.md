# Xeno Garden v2

**Smart drip irrigation that just works.** An ESP32 waters your plants on its own, a cloud backend keeps history and sends alerts, and a mobile app lets you watch and control everything from anywhere.

No IP addresses, no reflashing to change WiFi, no "is my phone on the same network?". You set up the device from the app over Bluetooth, and after that it works on any internet connection.

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
| `apps/mobile` | Expo SDK 57 app: onboarding over Bluetooth, live dashboard, control, history charts, alerts, plant health, settings | Jest + Testing Library |
| `firmware` | ESP32 firmware (PlatformIO): pump safety task, multi-WiFi, MQTT shadow, encrypted BLE setup | host C++ logic tests + ESP32 build |
| `services/ml` | FastAPI plant-health model service (baseline model, contract-tested) | pytest |
| `docs/` | Architecture, API, MQTT, hardware, deployment, security, ML integration, progress log | |

The build plan, and the source of truth for the whole project, is [`implementation_plan.md`](implementation_plan.md).

## Highlights

- **Zero network setup.** The app gives the device WiFi and cloud credentials over encrypted Bluetooth. The device remembers 5 networks and roams between them.
- **Safe by design.** The device runs automation itself, so it keeps watering offline. It has a hard maximum pump runtime, cooldown and rain lockout. It pauses on sensor faults. The pump is forced off at boot.
- **Honest UI.** Commands show "Starting…" until the device confirms. Settings show "Syncing to device…". Offline states are explained in plain words.
- **Real history.** Real time ranges (24 h → 90 d) with automatic rollups, pump sessions drawn on the chart, and a touch scrubber.
- **Alerts that aren't spam.** They're debounced, deduplicated (×37 instead of 37 alerts), cleared automatically, and pushed to your phone with a deep link.
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
4. Starts one simulated device. Sign in to the app with **demo@xeno.garden / demo-garden-1**.

Then run the app: `cd apps/mobile && npx expo start`. Bluetooth setup needs a development build (`eas build --profile development`). Everything else works in Expo Go. In development, the onboarding screen lists a **simulated device** so you can try the whole setup flow without hardware.

Options: `npm run dev -- --scenario drying --devices 3` (scenarios: `steady`, `drying`, `rain`, `sensor_fault`, `flaky_network`, `offline`). API docs: `http://localhost:4000/docs`.

## Tests

```sh
npm test                                   # unit tests, all packages
npm run test:int -w @xeno/backend          # integration: in-memory Mongo + MQTT
npm run test:e2e -w @xeno/backend          # whole system with a simulated device
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
- [Progress log](docs/PROGRESS.md)

## Configuration

Every setting comes from environment variables, validated at startup (`apps/backend/src/config/env.ts`). See `.env.example` and the table in [DEPLOY.md](docs/DEPLOY.md). No IP address, password or hostname is written in source code.
