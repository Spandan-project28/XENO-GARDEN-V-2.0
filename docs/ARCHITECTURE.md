# Xeno Garden v2 — Architecture

The authoritative design is in `implementation_plan.md` §3–§7. This file adds the flows as sequence diagrams and is kept in sync with the code.

## Components

```
ESP32 firmware ──MQTT/TLS──► MQTT broker ◄──MQTT── Backend (Fastify + Socket.IO) ──► MongoDB
      ▲                                                  ▲
      └──── BLE (setup only) ──── Mobile app ──HTTPS/WSS─┘
```

| Component | Location | Responsibility |
|---|---|---|
| Shared contracts | `packages/shared` | Zod schemas, MQTT topics, constants, the automation reference implementation, test vectors |
| Backend | `apps/backend` | Auth, device registry and claiming, device shadow, telemetry storage and queries, alerts, push, insights |
| Simulator | `apps/simulator` | Fake ESP32s that use the real MQTT contract |
| Mobile | `apps/mobile` | Expo app: onboarding over BLE, live dashboard, control, history, alerts, plant health |
| Firmware | `firmware` | Sensors, on-device automation, pump safety, multi-network WiFi, MQTT, BLE provisioning |
| ML service | `services/ml` | (Later) plant-health model behind the `PlantHealthProvider` port |

## Flow 1 — Onboarding (BLE provisioning + claim)

```
User        App                      ESP32 (pairing mode)          Backend            Broker
 │ Add dev → │ scan BLE "Xeno-*"       │                             │                  │
 │           │── connect, read info ──►│ {hwId, fw, claimCode}       │                  │
 │           │── POST /devices/claim {hwId, claimCode} ─────────────►│ create device +  │
 │           │◄───────────────────── {device, mqttCredentials} ──────│ mqtt user/ACL    │
 │           │── write cloud_creds ───►│ store in NVS                │                  │
 │           │── write wifi_scan ─────►│ scan                        │                  │
 │           │◄── notify networks ─────│                             │                  │
 │ pick+pw → │── write wifi_creds ────►│ connect WiFi                │                  │
 │           │◄── notify state ────────│ connecting_wifi → connecting_cloud             │
 │           │                         │── MQTT CONNECT (LWT) ───────────────────────────►│
 │           │                         │── status "online" (retained) ───────────────────►│──► backend marks online
 │           │◄── notify "online" ─────│                             │── socket "status"─┤
 │ ✓ Done    │                         │                             │                  │
```

## Flow 1b — Simple mode (v2.1, the default experience; implementation_plan §15)

```
First launch:  app ── POST /auth/guest ──► backend      (silent; no sign-up screen)
Garden screen: quiet BLE scan (only if no OS prompt is needed) → "2 new devices nearby → Connect"
Connect:       for each device, one after another (features/setup/autoSetup.ts):
                 info.mode == setup  → claim → cloud_creds → WiFi → online   (named "Xeno N")
                 info.mode == rejoin → mine? → WiFi only → online           (no claim code exposed)
WiFi choice:   network that worked for the previous device
               → phone's own WiFi (if the device sees it and the password is in the keychain vault)
               → any visible network in the vault
               → ask once (password saved only after the device proves it works)
Later:         device can't join any saved WiFi for 2 min → advertises in rejoin mode by itself
               → app shows "Xeno 1 needs WiFi → Fix WiFi"
```

In Expo Go (no Bluetooth), two simulated devices stand in for the radio. On `npm run dev`, the simulator's virtual radio (`apps/simulator/src/bridge.ts`) receives their credentials and runs them as real MQTT devices.

## Flow 2 — Manual pump command

```
App ── POST /devices/:id/pump {ON, 600s} ─► Backend
Backend: desired.manual = {pump:ON, cmdId, expiresAt}; version++ ; publish desired (retained)
Backend ── publish cmd {cmdId, type:pump, action:ON, expiresAt} ─► Device
Device: apply → relay ON → publish cmd/ack {cmdId, ok} + reported {pump:ON, pumpReason:manual}
Backend ── socket cmd_ack + shadow ─► App (button leaves "Starting…" state, starts countdown)
Device at expiresAt: relay OFF on its own, reported {pump:OFF, pumpReason:manual_expired}
```

## Flow 3 — Auto cycle (on device, works offline)

```
every tick (1 s): read sensors → evaluate(state, settings, now) → drive relay
every telemetryIntervalSec: publish telemetry (buffered if offline)
on pump change: publish telemetry + reported immediately
Backend: store reading → alert engine (debounced) → socket fan-out → push notification if needed
```

## Flow 4 — Settings change

```
App PUT /devices/:id/settings → Backend validates (shared Zod) → desired.settings, version++ → publish desired (retained)
Device receives desired (also on every reconnect, because it's retained) → if version > applied: apply + save to NVS
Device publishes reported.settingsVersion = version → App shows "Synced ✓"
```

## Automation rule order (shared by firmware, simulator and backend tests)

1. Pump has been ON ≥ `maxPumpRunSec` → OFF, reason `max_runtime`. Cooldown starts and any active manual command is cancelled. This applies to **every** source, manual included.
2. An unexpired manual command exists (any mode) → follow it. ON is refused during cooldown (reason `cooldown`). When it expires, control goes back to the mode.
3. Mode `manual` with no active command → OFF (`idle`).
4. Soil sensor fault → OFF, reason `sensor_fault`.
5. Rain lockout on and raining → OFF, reason `rain`.
6. In cooldown → OFF, reason `cooldown`.
7. moisture < `moistureLow` → ON (`dry`); moisture > `moistureHigh` → OFF (`wet`); otherwise hold the current state (`hold`, hysteresis).

The exact behaviour is defined by `packages/shared/test-vectors/automation.json`.
