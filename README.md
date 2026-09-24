# Xeno Garden v2

Smart drip irrigation: an **ESP32** that waters on its own, a **cloud backend**, and a **mobile app**.
You don't type any IP addresses: the device joins WiFi through in-app Bluetooth pairing, and the app works on any internet connection.

```
ESP32 ──MQTT/TLS──► broker ◄── backend (Fastify + Socket.IO) ──► MongoDB
  ▲                                ▲
  └── BLE (setup) ── mobile app ───┘  HTTPS + WebSocket
```

| Folder | What it is |
|---|---|
| `packages/shared` | Contracts used everywhere: Zod schemas, MQTT topics, constants, the automation rules plus golden test vectors |
| `apps/backend` | REST API, embedded MQTT broker, device shadow, history, alerts, push notifications |
| `apps/simulator` | Fake ESP32s that use the real MQTT contract (demo and test without hardware) |
| `apps/mobile` | Expo (React Native) app |
| `firmware` | ESP32 firmware (PlatformIO) |
| `docs/` | Architecture, progress log, and the API/MQTT/hardware/ML docs |

The build plan, and the source of truth for the whole project, is [`implementation_plan.md`](implementation_plan.md).

## Quick start (local, no Docker needed)

Requirements: Node ≥ 22.

```sh
npm install
npm run dev
```

`npm run dev` does the following:

1. Starts a local MongoDB. It uses `$MONGO_URI` if set; otherwise it runs a bundled mongod with data in `.data/`.
2. Starts the backend in watch mode with an **embedded MQTT broker**.
3. Detects your computer's LAN address and writes it to `apps/mobile/.env.local`, so the app on your phone and real ESP32 boards on the same WiFi find the dev server automatically.
4. Starts one simulated device. Sign in to the app with **demo@xeno.garden / demo-garden-1** to watch it.

Options: `npm run dev -- --scenario drying --devices 3`, or `--no-sim`.
Simulator scenarios: `steady`, `drying`, `rain`, `sensor_fault`, `flaky_network`, `offline` (`npm run sim -w @xeno/simulator -- --help`).

API docs (Swagger) are at `http://localhost:4000/docs`.

## Tests

```sh
npm test                                  # unit tests (all packages)
npm run test:int -w @xeno/backend         # integration (in-memory Mongo + MQTT)
npm run test:e2e -w @xeno/backend         # full system: runtime + simulated device
npm run test:all                          # everything
```

## Configuration

Every setting comes from environment variables. See `.env.example` and `apps/backend/src/config/env.ts`, which validates them at startup and lists anything missing.
No IP address, password or hostname is ever written in source code.
