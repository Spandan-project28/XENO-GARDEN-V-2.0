# Progress Log (append-only)

Format: `## YYYY-MM-DD — <task id> <title>` then *Changed*, *Verified*, *Follow-ups*.

## 2026-09-24 — Environment notes
- Toolchain found: Node v24.20.0, npm 11.19.0, git 2.55, TypeScript 6.0, turbo 2.11, ESLint 10.
- NOT available: PlatformIO (`pio`), Docker, Python. Consequences:
  - Firmware build (`pio run`) → 🧑 HUMAN unless PlatformIO gets installed; firmware *logic* is kept pure C++ so it can be tested with any C++ compiler if one exists.
  - docker-compose is written but dev/tests use in-process infra (mongodb-memory-server + aedes), so nothing depends on Docker.
  - `services/ml` (Python) will be written but not executed locally.

## 2026-09-24 — P0.1 Workspace foundation
- *Changed:* root `package.json` (npm workspaces apps/* packages/*, packageManager npm@11.19.0), `turbo.json`, `tsconfig.base.json` (strict, NodeNext), `.gitignore`, `.editorconfig`, Prettier, ESLint flat config (`eslint.config.mjs`, typescript-eslint).
- *Verified:* `npx turbo run typecheck` runs (0 tasks yet), `npx eslint .` clean.

## 2026-09-24 — P0.2–P0.4 Docs, dev infra, git
- *Changed:* `docs/ARCHITECTURE.md` (components, 4 sequence flows, the final automation rule order — manual commands work in any mode, max-runtime overrides everything). `docker-compose.yml` (mongo:7, mosquitto:2 with an ACL of one subtree per device), `infra/mosquitto/*`, `.env.example`. `git init`, `.gitattributes` (LF), `.claude/` ignored.
- *Verified:* files present; git staged cleanly.
- *Follow-ups:* the backend should support `MQTT_EMBEDDED=true` (aedes in-process broker) so dev works without Docker.

## 2026-09-24 — P1.1–P1.5 Shared contracts (`@xeno/shared`)
- *Changed:* Zod 4 schemas (auth, device/settings/shadow/claim/pump, telemetry/readings/pump events, alerts, plants/health), MQTT topic builders/parser + payload schemas, constants (BLE UUIDs, limits, defaults, enums, socket events, error codes), `evaluateAutomation()` + `rawToMoisture()` (handles inverted capacitive sensors and flags rail readings as faults), 33 golden vectors in `test-vectors/automation.json`. Built as ESM to `dist/`, which the backend, simulator and mobile consume.
- *Decisions:* ADR-008 (pump commands go through desired.manual), ADR-009 (the claim returns broker info), ADR-010 (manual works in any mode). Plan §7 updated.
- *Verified:* `turbo run typecheck lint build test --filter=@xeno/shared` → 4/4 tasks; 56 tests pass (all 33 vectors plus property tests). Importing `@xeno/shared` from Node works.
- *Note:* multi-file bash heredocs with quotes get cut off in this shell. Use the Write tool for large files.

## 2026-09-24 — P2.1 Backend app shell
- *Changed:* `apps/backend` (Fastify 5 + fastify-type-provider-zod 7): Zod env loader (fails fast, lists every problem, rejects placeholder secrets in prod), `AppError` + global error handler (§7.2 shape for validation/404/429/500), helmet, CORS allow-list (open in dev), rate limit, Swagger at `/docs`, request IDs, `/v1/health` (db/mqtt/devices; 503 when degraded), typed in-process `AppBus`, and a `Deps` injection object. Vitest projects: unit / int / e2e.
- *Verified:* 10 unit tests pass; `tsc --noEmit` and eslint clean.

## 2026-09-24 — P2.2 Models + P2.3 Auth
- *Changed:* `src/db/models.ts`, with all §6 collections in one file (one source for indexes): the `readings` time-series collection (30-day TTL), `readings_hourly` (unique device+hour), and the alerts partial unique index on the `active: true` flag. Partial indexes can't use `$in`, so the flag replaces a status filter. `connectDb` syncs collections and indexes at boot.
  Auth module: argon2 (@node-rs) passwords, HS256 access JWT (fast-jwt, 15 min), opaque rotating refresh tokens (sha256 stored) with family reuse detection, lockout after 5 failures for 15 min, constant-time path for unknown emails, `/auth/register|login|refresh|logout`, `GET/PATCH /me`, strict rate limits. `container.ts` wires Deps. Test helpers: in-memory Mongo + `createTestApp().signUp()`.
- *Verified:* 15 int tests (6 model/index, 9 auth) and 10 unit tests pass; typecheck and lint clean.
- *Notes:* MongoDB 8.2.6 binary is cached at root `node_modules/.cache/mongodb-memory-server` (vitest config sets MONGOMS_DOWNLOAD_DIR). The mobile app must single-flight refresh calls, or reuse detection will log it out.

## 2026-09-24 — P2.4 Devices module
- *Changed:* `modules/devices` — claim (register-or-transfer, ADR-011; returns broker `{host,port,tls,username=hardwareId,password}` from `DEVICE_BROKER_*` env), list/get/patch (name, own plantId only)/delete, an ownership guard that returns 404 for other users' devices, `verifyMqttCredentials` for broker auth, and `device.removed` bus events.
- *Verified:* 8 device int tests pass (23 int total); typecheck and lint clean.

## 2026-09-24 — P3.1 MQTT broker + gateway
- *Changed:* `src/mqtt/broker.ts`, an embedded aedes broker (`MQTT_EMBEDDED=true`). Devices authenticate with username = clientId = hardwareId plus the claim-issued password, checked against the DB. Per-device ACL: publish telemetry/reported/status/event/cmd/ack and subscribe desired/cmd, only in its own subtree. Violations disconnect the client; denied subscriptions get SUBACK 128. The backend service account uses a random password generated at boot. It tracks connected devices and can kick a device.
  `src/mqtt/gateway.ts` (`DeviceGateway`, mqtt.js): wildcard subscriptions, a per-device ordered queue, Zod validation of every payload (invalid ones are dropped and logged), `publishDesired` (retained), `clearDesired`, `publishCommand`.
- *Verified:* 6 MQTT int tests (auth, spoofing, ACL, retained desired, ordering, LWT on power loss); 29 int tests green on two consecutive runs; lint clean.

## 2026-09-24 — P3.2 Telemetry ingest
- *Changed:* `modules/telemetry/ingest.ts` — telemetry → `readings` (trusts the device NTP timestamp only within ±10 min), updates `devices.latest/lastSeenAt`, marks the device online (emitting once), LWT status handling, device events → bus, `sweepStale()` for devices that go silent without an LWT. Unclaimed devices are ignored.
- *Verified:* 6 ingest int tests pass; typecheck clean.

## 2026-09-24 — P3.3 Device shadow / control
- *Changed:* `modules/control` — `PublisherProxy` (late-bound MQTT publisher), a compare-and-swap `desired` writer with jittered retries (no lost concurrent updates), settings patch merged then re-validated, mode switch cancels the manual command, pump ON capped at maxPumpRunSec with cmdId/expiry, OFF means pause in auto / clear in manual, pump commands refused while offline (409 DEVICE_OFFLINE), one-shot `/commands`. Reported state is stored (`syncPending` is derived from appliedVersion). When the device drops a manual command on its own, desired is cleared so a reboot doesn't replay it. `republishAll()` runs after broker restarts. Desired changes are persisted even when MQTT is down. A shared pino logger is used across HTTP, MQTT and services.
- *Verified:* 15 control int tests, green on 3 consecutive runs; typecheck clean.

## 2026-09-24 — P3.4 Pump events + P3.6 History queries
- *Changed:* `telemetry/pumpEvents.ts` turns reported pump transitions into sessions (source auto/manual, stopReason). It is called in order from the MQTT reported handler, not through the bus, so transitions never race. `telemetry/queries.ts` auto-picks a resolution (≤6h raw, ≤3d 5-minute `$dateTrunc` buckets, ≤45d hourly, then daily). Hourly and daily come from `readings_hourly`, filled by an idempotent `rollup()` (`$merge` upsert) with sample-weighted averages. Daily buckets use an optional IANA `tz` (added to the shared `readingsQuery`). `pumpOnSec` is computed from session overlaps, with open sessions counted up to now. Routes: `GET /devices/:id/readings`, `GET /devices/:id/pump-events`.
- *Verified:* 8 history int tests pass; lint clean.

## 2026-09-24 — P3.5 Realtime gateway + runtime
- *Changed:* `realtime/socket.ts`, Socket.IO namespace `/rt` with a JWT handshake. Rooms `user:{id}` (status, alerts, removals) and `device:{id}` (telemetry, shadow, events, cmd_ack). `subscribe` checks ownership and returns a device snapshot. Typed payloads live in `@xeno/shared/realtime`.
  `runtime.ts` assembles everything: DB → services → embedded broker or external MQTT → gateway handlers (reported → shadow → pump sessions, in order) → HTTP → realtime → jobs (stale sweep every 30 s, hourly rollup every 5 min). `server.ts` is the entry point with graceful shutdown. The gateway `onConnect` republishes all desired state after (re)connects.
- *Bug found & fixed:* claiming never published the initial desired state, so a newly paired device waited for config forever. Now `device.claimed` → kick the old session and publish retained desired.
- *Verified:* 6 realtime int tests through the real runtime (socket auth, telemetry/status fan-out, desired/reported/cmd_ack, cross-user isolation, removal kicks the device). Full backend: 74 tests pass; lint and build clean.

## 2026-09-24 — P4.1 Alert engine + P4.2 Alert routes
- *Changed:* `alerts/engine.ts` with a `ConditionTracker` (open-after and clear-after delays, raise once, touch at most once a minute). Rules: LOW_MOISTURE (dry for N min, critical when far below threshold), SENSOR_FAULT (1 min of missing readings or a device event), HIGH_TEMP (10 min, 2 °C hysteresis), DEVICE_OFFLINE (`tick()`, 3 min grace, cleared on online), PUMP_MAX_RUNTIME (cleared by the next watering that ends wet). Alerts close automatically when a device is removed.
  `alerts/service.ts`: `raise` does an atomic bump, else create, catching duplicate-key errors so concurrent raises collapse into one; `touch`, `clear`, cursor pagination (lastSeenAt+id), counts, ack/resolve with ownership. Routes: `GET /alerts`, `GET /alerts/counts`, `POST /alerts/:id/ack|resolve`. The runtime runs `tick()` every 30 s.
- *Verified:* 5 tracker unit tests + 12 alert int tests (1000 dry events → exactly 1 alert, 25 concurrent raises → 1 alert with count 25, pagination, isolation). Lint clean.

## 2026-09-24 — P4.3 Push notifications
- *Changed:* `notifications/` — the `PushSender` interface with `ExpoPushSender` (chunks of 100, maps DeviceNotRegistered) and `NoopPushSender` (used in tests and when PUSH_ENABLED=false). Notifies on alert.opened and reminds on recurrence at most every 30 min, claiming `lastNotifiedAt` atomically so pushes are never sent twice. Respects per-type prefs, removes dead tokens, and moves a token to whichever account is signed in on the phone (max 10 per user). Routes: `POST/DELETE /me/push-tokens`, `GET/PUT /me/notification-prefs`. Push data carries a deep-link URL for the app.
- *Verified:* 5 notification tests; full backend suite green; lint clean.

## 2026-09-24 — P5.1 Simulator
- *Changed:* `apps/simulator` (`@xeno/simulator`, CLI `npm run sim -w @xeno/simulator -- --devices 2 --scenario drying`):
  - `SimDevice` copies the firmware at the MQTT level: status/LWT, subscribes to desired + cmd, applies desired by version, manual commands with local expiry, and the shared `evaluateAutomation` every tick (works offline).
  - Telemetry on the interval and on pump change, with an offline buffer that flushes on reconnect. Reported state on change plus a 60 s heartbeat. cmd → ack (reboot drops and reconnects). max_runtime and sensor fault/recovered events.
  - A deterministic garden physics model (seeded RNG, daily temperature curve) and 6 scenarios.
  - `provision.ts` signs in or registers and claims over the public REST API, just like the app does.
- *Verified:* 10 simulator unit tests (fake transport + fake clock); typecheck, lint and build clean.

## 2026-09-24 — P5.2 End-to-end suite
- *Changed:* `apps/backend/test/e2e/full-flow.test.ts` runs the real runtime (HTTP + embedded MQTT + Socket.IO + in-memory Mongo) and a simulated device onboarded through the public API. Steps: sign up, claim, device applies desired v1, live telemetry over the socket, manual mode confirmed by reported state, pump ON 10 s acknowledged then expired on the device (pump session about 10 s, desired.manual cleaned up), a dry garden gives exactly 1 LOW_MOISTURE alert, history returns readings plus pump time, power cut → LWT offline → DEVICE_OFFLINE alert, and pump commands are refused while offline. Added `SimDevice.powerCut()`.
- *Verified:* `npm -w @xeno/backend run test:e2e` → 7/7, green on 3 consecutive runs.

## 2026-09-24 — P5.3 One-command dev
- *Changed:* `tools/dev.mjs` (`npm run dev`): Docker-free local stack. It uses `$MONGO_URI`, or starts a persistent local mongod from the mongodb-memory-server binary (`.data/mongo`, port 27018). It detects the LAN IPv4 (skipping virtual adapters), passes it as `DEVICE_BROKER_HOST` and writes `apps/mobile/.env.local` (`EXPO_PUBLIC_API_URL`). A generated JWT secret is kept in `.data/`. It starts the backend in watch mode with the embedded broker, waits for health, then runs the simulator with the demo account. README quick start written. Replaced the deprecated Mongoose `{ new: true }` with `returnDocument: 'after'`.
- *Verified:* ran `node tools/dev.mjs --port 4100 --mqtt-port 1893`: mongod started, backend healthy, the LAN address was detected, the simulated device claimed, connected over MQTT and applied desired v1, and the status line showed live soil values. Processes stopped afterwards. Backend: 103 tests (unit+int+e2e) green.

## 2026-09-24 — P6.1 Mobile scaffold
- *Changed:* `apps/mobile` (`@xeno/mobile`) created from the Expo SDK 57 default template (React 19.2, RN 0.86, Expo Router 57, React Compiler, typed routes), with the template demo removed. `app.json`: name, scheme `xenogarden`, bundle IDs `garden.xeno.app`, dark splash, plugins (secure-store, ble-plx with permission text, notifications, font). `eas.json` has development/preview/production profiles using EAS environments. `src/config/env.ts` resolves the API URL from `EXPO_PUBLIC_API_URL`, or in dev from the Metro host, so no typing is needed; production builds never guess. `src/config/flags.ts` uses static env references (the linter caught that dynamic access is never inlined). Jest set up with jest-expo, module mocks and a transform allow-list for workspace ESM. Installed: TanStack Query, Zustand, socket.io-client, lucide, react-native-svg, secure-store, async-storage, netinfo, haptics, blur, linear-gradient, notifications, ble-plx, and the Manrope + Space Grotesk fonts.
- *Verified:* `tsc --noEmit` clean, `expo lint` clean (ESLint 9 pinned in mobile), jest 4/4, `expo-doctor` 21/21, `expo export --platform android` produced a 2.7 MB Hermes bundle.

## 2026-09-24 — P6.2 Design system
- *Changed:* `src/design/tokens.ts` holds the only raw values in the app: dark "Night garden" and light "Morning garden" palettes (same token set, semantic colours for water/sun/humidity/rain), spacing, radii, fonts (Space Grotesk display + Manrope body), a type scale, motion springs and layout constants. `theme.ts` builds the themes with platform elevation. `ThemeProvider` + `useTheme` + `makeStyles` (styles memoised per theme). `lib/prefs.ts` is a zustand store persisted to AsyncStorage (theme preference system/light/dark, units, last device).
- *Verified:* 4 design tests including automated WCAG contrast checks (text ≥ 7:1, secondary ≥ 4.5:1, accents ≥ 3:1 in both themes); typecheck and lint clean.

## 2026-09-24 — P6.3 UI primitives
- *Changed:* `src/ui/`: Text (variants/tones/tabular numbers), PressableScale (spring press plus haptics), Card (solid/glass/outline/tinted), Button and IconButton, Screen (gradient background, safe area, header, pull to refresh, tab-bar spacing, keyboard avoidance), Chip/ChipGroup, SegmentedControl (sliding indicator), StatusDot and Badge (pulse), Gauge (animated 270° SVG ring with threshold band), Skeleton/SkeletonCard, EmptyState, TextField (label/error/password toggle), Toggle, ListRow/ListGroup, Banner, MetricTile, Sheet (bottom sheet), a Toast store with host and imperative `toast.*`, Slider and RangeSlider (gesture-handler + Reanimated 4 with `scheduleOnRN`, accessible increment/decrement). Everything reads tokens through `useTheme`; there are no raw colours in components.
- *Fixes found along the way:* duplicate React (root 19.3.0 vs app 19.2.3) broke hooks, so a root `overrides` pins react/react-dom 19.2.3. React Compiler lint requires `sharedValue.set()` rather than `.value =`. RNTL 14 APIs are async. Jest maps lucide to its CJS build and loads the worklets/reanimated/gesture-handler test setups. Banner needed `accessible` for its alert role.
- *Verified:* 24 mobile tests (UI render + interaction + a11y roles in both themes); typecheck and lint clean.

## 2026-09-24 — P6.4 Mobile core libraries
- *Changed:* `lib/api/client.ts` — `ApiClient` with bearer auth, single-flight refresh on 401 (never sends a rotated refresh token twice), a retry, sign-out only when refresh returns "session over" (offline refresh failures keep the session), mapping of the backend error shape to `ApiError`, a 15 s timeout, NETWORK/TIMEOUT codes and Zod response validation. `lib/api/endpoints.ts` has a typed function for every endpoint, using the shared schemas. `lib/session.ts`: refresh token in the keychain (SecureStore, localStorage on web), access token only in memory, cached profile for instant/offline startup, sign-out listeners. `lib/queryClient.ts`: TanStack Query defaults (no retry on 4xx), AsyncStorage persistence, NetInfo online manager, AppState focus manager. `lib/realtime.ts`: `RealtimeManager` with ref-counted subscriptions, resubscribe on reconnect, token refresh + reconnect on UNAUTHORIZED, cache patching via `lib/deviceCache.ts`, and a live telemetry ring buffer. `useLiveDevices()` hook. `components/ConnectionBanner.tsx` shows offline, or reconnecting after a 4 s grace. `lib/lifecycle.ts` wipes cache, socket and live data on sign-out. The session store moved into `lib` to keep the lib→features layering.
- *Verified:* 38 mobile tests (client: token/refresh single-flight/offline/error mapping/validation; cache patchers; realtime ref-counting, resubscription, telemetry flow). Typecheck and lint clean.
