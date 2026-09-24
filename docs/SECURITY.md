# Xeno Garden v2 — Security overview

## What we protect

| Asset | Why it matters |
|---|---|
| Control of the pump | Flooding, or plants dying if someone disables watering |
| User accounts | Access to all of a user's gardens |
| WiFi passwords | Given to the device during setup |
| Device broker credentials | Would let someone impersonate a device |
| Readings, photos | Personal data (home location patterns, pictures) |

## Controls by layer

### Accounts & API (`apps/backend`)
- Passwords hashed with **argon2** (`@node-rs/argon2`). The unknown-email path runs a dummy hash so timing doesn't reveal which emails exist.
- **Lockout** for 15 min after 5 failed logins. Rate limits: auth 10/min, claim 20/min, pump 30/min, global 300/min per IP.
- **Access tokens:** 15-minute HS256 JWTs. The secret must be ≥ 32 characters, and a placeholder secret is rejected in production.
- **Refresh tokens** are opaque, stored only as SHA-256, and **rotated** on every use. Presenting an already-rotated token revokes the whole session family (theft detection). The app refreshes in single-flight so a real user never trips this.
- Every request body, query and param is validated with the shared **Zod** schemas. Bodies are capped at 256 KB. Mongoose `strictQuery` is on.
- **Ownership checks** on every `:id` route. Other users' devices, plants and alerts look like **404**, not 403, so nothing leaks.
- Errors use a fixed shape. 5xx responses never include internals or stack traces.
- `helmet` security headers. CORS allow-list (`CORS_ORIGINS`; native apps send no Origin).
- Logs redact `authorization`, passwords and refresh tokens.

### Devices & MQTT
- Each device has its own MQTT password, generated at claim and stored as SHA-256. **Every claim rotates it**, and removing a device kicks its session.
- **Per-device ACL** (embedded broker, and `infra/mosquitto/acl` for Mosquitto): a device may only publish its own `telemetry/reported/status/event/cmd/ack` and subscribe to its own `desired/cmd`. Violations disconnect it. Tested in `test/int/mqtt.test.ts`.
- `clientId` must equal the username, which prevents session takeover under another id.
- Payload limits: broker 16 KB, gateway 8 KB. Every inbound payload is Zod-validated; bad ones are dropped and logged.
- The firmware **clamps** every received setting to the shared limits: no desired message can remove the pump's max-runtime safety.
- TLS to managed brokers. Put the broker root CA in `firmware/certs/ca.pem`. Without it the connection is encrypted but unauthenticated (logged as a warning). **Production builds must include the CA.**

### Setup over Bluetooth
- Pairing mode opens only on first boot (unconfigured), on a 5 s physical button hold, or by a command from the device's owner. It closes 2 min later, or 15 s after setup succeeds.
- **Encrypted link**: LE Secure Connections, bonded. The WiFi password, broker credentials and claim code are never sent in clear over the air. "Just Works" pairing doesn't stop an active man-in-the-middle **within radio range during the pairing window**. We accept that because the window needs physical access to the device.
- Claiming requires the device's claim code, which is only readable over the encrypted link while in pairing mode. That is proof of physical possession. Another account's device can't be claimed remotely. The claim code survives factory reset.
- Received broker credentials must name this device (`username == hardwareId`). Frame reassembly is capped at 2 KB.

### Photos
- Uploads and downloads use **HMAC-signed, expiring URLs**: 10 min to upload, 24 h to view. Keys are whitelisted with a regex and resolved paths are checked (no traversal). The real file type is checked from magic bytes (JPEG/PNG/WebP), and uploads are capped at 5 MB. A photo can only be attached to the plant it was issued for.

### Mobile app
- The refresh token is in the OS keychain/keystore (`expo-secure-store`). The access token is only held in memory.
- No secrets in the app bundle. The server URL is build configuration.
- Sign-out revokes the session server-side, unregisters the push token and wipes cached data.

### Supply chain
- `npm audit`: 0 vulnerabilities in our dependency set except one **accepted** advisory: `decode-uri-component@0.2.2`, a DoS on malformed percent-encoding. It's used by expo-router's `query-string@7` to parse in-app links. The patched 0.5 release is ESM-only and breaks `query-string`'s `require()` (verified: deep links stop working), so we pin 0.2.2 until expo-router upgrades. Impact is limited to a crafted link freezing the app's own JS thread.
- `uuid` is forced to ≥ 11.1.1 via npm overrides.
- Library versions are pinned in PlatformIO (`platformio.ini`).

## Operational checklist (production)

- [ ] `NODE_ENV=production`, a long random `JWT_ACCESS_SECRET`, HTTPS in front of the API
- [ ] `CORS_ORIGINS` set (or empty if only the native app is used)
- [ ] Managed MQTT with TLS; broker CA in `firmware/certs/ca.pem`; `DEVICE_BROKER_TLS=true`
- [ ] MongoDB with authentication and network restrictions (Atlas IP allow-list)
- [ ] `ML_API_KEY` set if the ML service is exposed
- [ ] Backups for MongoDB; `UPLOAD_DIR` on persistent storage (or an S3/R2 driver)

## Reporting a problem

Open a private security advisory on the repository rather than a public issue.
