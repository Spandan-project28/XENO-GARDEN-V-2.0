# MQTT contract (v1)

Source of truth: `packages/shared/src/mqtt` (Zod schemas + topic helpers). The firmware (`firmware/src/mqtt_link.cpp`) and the simulator (`apps/simulator`) implement the device side; the backend gateway (`apps/backend/src/mqtt/gateway.ts`) implements the cloud side.

## Connection

| | Device | Backend |
|---|---|---|
| Client ID | hardware ID, e.g. `xg-3c71bf12ab34` | `xg-backend-<pid>-<time>` |
| Username / password | hardware ID / password issued at claim (rotated on every claim) | service account |
| Last will | `xg/v1/{hw}/status` = `offline`, retained, QoS 1 | – |
| Keep-alive | 15 s | default |

## Topics (all under `xg/v1/{hardwareId}/`)

| Leaf | Direction | Retained | QoS | Payload |
|---|---|---|---|---|
| `status` | device → cloud | yes | 1 | plain text `online` / `offline` (LWT) |
| `telemetry` | device → cloud | no | 0 | `{ts?, soilMoisture, soilRaw, temperature, humidity, rain, pump}`, where sensors may be `null` (fault). Sent every `telemetryIntervalSec` and immediately when the pump changes. Buffered while offline. |
| `reported` | device → cloud | yes | 0/1 | `{appliedVersion, mode, pump, pumpReason, manualCmdId, manualRemainingSec, cooldownRemainingSec, fwVersion, rssi, ssid, ip, uptimeSec, heapFree, soilCalibrated}`. Sent on change and every 60 s. |
| `event` | device → cloud | no | 0/1 | `{type, ts?, data}`, where type is one of `boot`, `sensor_fault`, `sensor_recovered`, `max_runtime`, `wifi_changed`, `calibrated` |
| `desired` | cloud → device | **yes** | 1 | `{version, mode, settings, manual}` (see below). An empty payload means the device was unclaimed. |
| `cmd` | cloud → device | no | 1 | `{cmdId, type, issuedAt}`, where type is one of `identify`, `reboot`, `pairing`, `calibrate_dry`, `calibrate_wet`, `factory_reset`, `ota`. `ota` also carries `{url (https), sha256, version}` from the server's release channel. |
| `cmd/ack` | device → cloud | no | 0/1 | `{cmdId, ok, error?}` |

### `desired` (device shadow)

```json
{
  "version": 7,
  "mode": "auto",
  "settings": { "moistureLow": 30, "moistureHigh": 45, "maxPumpRunSec": 600, "cooldownSec": 300,
                "rainLockout": true, "highTempC": 38, "telemetryIntervalSec": 5 },
  "manual": { "cmdId": "k3J9…", "pump": "ON", "durationSec": 600, "issuedAt": 1790000000000, "expiresAt": 1790000600000 }
}
```

- Only the backend writes `desired`. Every change bumps `version`, and it's re-published after every backend/broker restart.
- The device ignores versions it has already applied, clamps settings to the safe limits, persists them, and confirms through `reported.appliedVersion`.
- `manual` is a time-limited override. The device converts `expiresAt` to its own clock (NTP), or uses `durationSec` if its clock isn't synced, and never runs longer than the duration.
- When the device drops a manual command itself (safety limit, cooldown, expiry), `reported.manualCmdId` becomes `null`. The backend then clears `desired.manual`, so a reboot can't replay it.

## Automation (runs on the device)

Rules, in order: max runtime → manual command → manual mode idle → sensor fault → rain → cooldown → moisture thresholds with hysteresis. Defined once in TypeScript (`packages/shared/src/automation`), ported to C++ (`firmware/lib/xg_core`), and both are checked against `packages/shared/test-vectors/automation.json`.

## Firmware updates (OTA)

The server sends `cmd` type `ota` with the release's HTTPS URL, SHA-256 and version. The client app can't supply these: `POST /devices/:id/commands` refuses `ota`, and `POST /devices/:id/firmware/update` uses the server's `FIRMWARE_LATEST_*` settings. The device streams the image into its inactive OTA slot while hashing it, activates it only if the SHA-256 matches, acks on `cmd/ack`, and reboots. The pump safety task keeps running during the download.

## Limits

The broker rejects publishes over 16 KB and the gateway drops messages over 8 KB. Every payload is schema-validated; invalid ones are logged and dropped.
