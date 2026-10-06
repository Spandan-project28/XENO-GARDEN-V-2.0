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

## 2026-09-24 — P6.5 Auth + gated routing
- *Changed:* Root layout: fonts (Manrope, Space Grotesk), splash held until fonts, session and prefs are ready, providers (gesture, safe area, theme, persisted TanStack Query, toasts, themed status bar). `Stack.Protected` gates `(app)` and `(auth)` on session status. `ConfigErrorScreen` covers builds without a server URL. `(auth)` routes welcome/sign-in/sign-up are thin re-exports of `features/auth` screens: an animated brand mark, validation with the shared Zod schemas via `lib/forms.validate`, server errors mapped to fields (409 → email), password toggle, keyboard flow, and a dev-only "use demo account". `(app)` layout starts and stops the realtime connection. The `(tabs)` layout has a custom floating glass `TabBar` (animated active pill, alert badge from `/alerts/counts`). Placeholder tab screens until P6.6+.
- *Verified:* 43 mobile tests (5 new auth-flow tests: validation, success establishes the session, 401 message, 409 → email field, password length). Typecheck and lint clean; Android export 7.2 MB OK.

## 2026-09-24 — P6.6 Home screen
- *Changed:* `features/devices/HomeScreen.tsx`: greeting header with an add-device button, ConnectionBanner, skeletons, error banner with retry, an inviting empty state that starts onboarding, a garden overview (online / watering / thirsty), animated staggered `DeviceCard`s (moisture gauge with threshold band, happy/thirsty state, a human pump-reason line, temperature/humidity/rain pills, status badge Online/Watering/Offline · last seen, Auto/Manual badge). Live updates via `useLiveDevices`. `lib/format.ts` (units, relative time, countdowns, reason copy, greetings, moisture state), `lib/useNow`, `features/devices/hooks.ts` (`useDevices`, `useDevice` seeded from the list cache, `pumpState`). Test fixtures and a NetInfo jest mock.
- *Verified:* 52 mobile tests (format + 4 Home states: empty → onboarding, cards/overview/offline/thirsty/navigation, watering, error). Typecheck and lint clean.

## 2026-09-24 — P6.7 Device detail
- *Changed:* `features/devices/DeviceDetailScreen.tsx` (route `/device/[id]`):
  - Offline banner explaining that the device keeps working. A hero glass card with the status badge, a "Syncing to device…" badge while desired ≠ applied, the 240 px moisture gauge with target band, and a human reason line.
  - Auto/Manual SegmentedControl with an optimistic update and rollback, plus plain-language mode copy.
  - `PumpControl`: a big round button with ripples while watering, duration chips capped at the device safety limit, and "Starting…/Stopping…" until the device reports `appliedVersion ≥` the command's version. After 20 s without confirmation it says so honestly instead of pretending. A live countdown from `manualRemainingSec`, and it is disabled offline.
  - Metrics tiles; a 24 h sparkline (5-minute buckets plus live points) linking to History; last watering and weekly sessions from pump events; a plant-health entry (flagged); device info (WiFi signal quality, firmware, last seen, hardware ID).
  - `useDeviceMutations` (mode/pump/settings/rename/command/remove with cache updates and toasts). `ui/charts/path.ts` (segments with gaps, smooth paths, domains) and `Sparkline`.
- *Verified:* 66 mobile tests (pump UI derivation incl. confirmation by version, countdown, never-confirmed; chart geometry; detail screen render/optimistic mode/pump command/offline). Typecheck and lint clean (the React Compiler purity rule caught `Date.now()` during render; fixed).

## 2026-09-24 — P6.8 History
- *Changed:* `features/history`:
  - Range chips 24H/7D/30D/90D map to real `from/to` windows (aligned to 5 min) with the phone's IANA time zone sent for daily buckets.
  - Device chips (remembered in prefs; `?deviceId=` from the detail screen) and a metric toggle (soil/temperature/air humidity, °F aware).
  - `ui/charts/LineChart` (SVG): gridlines + axis labels, gradient area, gaps for missing data, dashed threshold lines (water below / stop above), shaded pump-running bands from pump sessions, and a touch-and-drag scrubber with a value/time readout (gesture-handler + `scheduleOnRN`).
  - Stats tiles (avg soil, avg temp, total watering) and a list of watering sessions with source, duration and stop reason. Empty/error/skeleton states.
  - The devices feature got a public `index.ts`, so features only import each other's public API.
- *Lesson:* my test output filter showed only "Tests:" and hid a suite that failed to load. From now on I check the "Test Suites:" line too.
- *Verified:* 12 suites / 71 tests (range math, real window sent to the API, range and device switching, sessions list, empty state). Typecheck and lint clean.

## 2026-09-24 — P6.9 Alerts
- *Changed:* `features/alerts`: infinite cursor list (Active = open+acknowledged, All), sections by day (Today / Yesterday / date), `AlertRow` with severity colours, type icon, repeat count "×37", device, age and status, plus swipe-left actions (Seen / Resolve) via `ReanimatedSwipeable`. Tapping opens a bottom sheet with "What to do" advice per alert type, actions and a jump to the device. Push deep link `?focus=<id>` highlights the alert and opens its sheet once. Optimistic ack/resolve updates both lists and the tab badge count. Empty state "All clear", load older pages.
- *Verified:* 13 suites / 77 tests (grouping, counts, sheet resolve removes from the active list, deep link, pagination). Typecheck and lint clean.

## 2026-09-24 — P6.10 Device settings
- *Changed:* `features/devices/DeviceSettingsScreen.tsx` (route `/device/[id]/settings`):
  - A draft form over `desired.settings`: moisture RangeSlider (min gap from shared limits, with guidance copy), max run time, cooldown, a rain lockout toggle, heat-warning temperature and telemetry interval.
  - A sticky Reset/Save bar appears only when there are changes; it validates the merged draft with the shared `deviceSettings` schema and sends a diff of only the changed fields.
  - Sync status: "Syncing to device…" until the device applies the new version, "up to date" afterwards, and an offline note that changes apply on reconnect.
  - Device actions: rename (sheet), change WiFi (onboarding in `mode=wifi`), a 2-step soil calibration sheet (dry in air, then wet in water, via `calibrate_*` commands), identify (blink), and remove with a confirmation dialog.
  - The form remounts only when the saved settings change, so a pump command bumping the version doesn't wipe edits.
- *Verified:* 14 suites / 83 tests (diff, validation, duration format, save sends only the changed field and shows syncing, offline note, rename). Typecheck and lint clean.

## 2026-09-24 — P6.11 App settings
- *Changed:* `features/settings/SettingsScreen.tsx`: profile card with initials avatar and a name-edit sheet (`PATCH /me` updates the session user), theme Auto/Light/Dark and °C/°F (persisted prefs, applied live), notification master and per-alert-type toggles (optimistic, rollback on error), About (app version, server URL, data retention), sign out with confirmation (revokes the refresh-token family server-side and wipes local data). The auth feature got a public `index.ts`.
- *Verified:* 15 suites / 86 tests; typecheck and lint clean.

## 2026-09-24 — P6.12 Push notifications (app side)
- *Changed:* `lib/push.ts`: foreground banner handler, Android "alerts" channel, a permission status model (unsupported/undetermined/denied/granted), Expo token → `POST /me/push-tokens` (idempotent, token remembered), unregister on sign-out while still authenticated, and tap navigation to the push `data.url` (`/alerts?focus=<id>`) plus alert refetch when a notification arrives. `components/PushPrompt.tsx` on Home explains why before asking, and links to phone settings if denied. Registration is skipped gracefully without an EAS project ID, on web, or on simulators.
- *Verified:* 16 suites / 89 tests (asks only when allowed, registers the token with projectId, respects denied, unregisters on sign-out). Typecheck and lint clean.
- *Human dependency:* real pushes need `eas init` (projectId) and a dev build (P6.15).

## 2026-09-24 — P6.13 Onboarding (BLE provisioning)
- *Changed:*
  - `@xeno/shared/ble` — protocol v1 (ADR-013): info/scan/creds/state Zod schemas and UTF-8-safe framing (`toFrames`/`FrameAssembler`).
  - Mobile `lib/ble`: `ProvisioningTransport`/`Session` interfaces; `PlxTransport` (react-native-ble-plx, lazily loaded so Expo Go shows a clear "needs app build" message; Android 12+ scan/connect permissions, adapter state, MTU 185, framed writes, monitored notifications); `MockTransport` with a simulated device that mirrors firmware behaviour (wrong password, no internet, cloud failure) and a demo device in the scan list when `demoProvisioning` is on; a UTF-8 ⇄ base64 codec.
  - `features/onboarding/flow.ts`: `ProvisioningFlow` state machine (intro → scan → connect → claim → cloud creds → WiFi list → password → join with a live device timeline → cloud confirmation by polling the backend → name → done; `mode=wifi` skips naming). Human error messages for every failure: wrong password, SSID not found, no internet, cloud blocked, Bluetooth off or no permission, claimed by another account, phone offline. Timeouts throughout.
  - `OnboardingScreen` (full-screen modal): step progress, intro checklist with the 2.4 GHz note, radar scan with "can't find it?" tips, connection stages, network list with signal and lock icons, hidden-network entry, password step, join timeline, naming with suggestion chips, and a success screen.
- *Verified:* shared 61 tests (framing incl. emoji/Devanagari, reassembly, validation); mobile 19 suites / 104 tests (7 flow tests, 2 full-wizard UI tests incl. a wrong-password retry, 6 codec tests). Typecheck and lint clean; Android export 7.6 MB OK.

## 2026-09-24 — P6.14 Plant health screen / P6.15 blocked
- *Changed:* `features/insights/PlantHealthScreen.tsx` (route `/device/[id]/health`). With no plant linked, a "What are you growing?" form creates the plant and links it (`plantId`). Otherwise it shows the latest `HealthReport`: score gauge coloured by status, summary, "checked X ago · Smart rules/AI model", findings with severity and confidence, "Run a new check", previous checks, and a photo-check card behind `flags.photoUpload`. It renders any provider's report, so ML plugs in without UI changes. The backend endpoints come in P8.1.
- *Verified:* 20 suites / 106 tests; typecheck and lint clean.
- *P6.15 BLOCKED (🧑 HUMAN):* needs an Expo account, `eas init` (sets the projectId used for push), `eas build --profile development --platform android`, and installing on a phone.

## 2026-09-24 — P7.1–P7.9, P7.12 Firmware
- *Tooling:* installed PlatformIO 6.2 and ziglang via pip (Python 3.14 was present), so firmware is now built and tested locally instead of being blocked on the human.
- *Changed:* `firmware/` (ESP32, Arduino, espressif32@6.9.0, pinned libs):
  - `lib/xg_core` (pure C++, host-testable): the automation port, calibration (`rawToMoisture` handles either sensor direction and treats rail values as faults), median filter, BLE frame assembler, and a desired-shadow parser that **clamps** every setting to the shared limits, plus manual-command clock conversion (NTP-synced epoch → monotonic; capped to the command duration against clock skew).
  - `src/`:
    - `pump.h` sets the relay latch OFF before the pin is enabled.
    - `control.cpp` is a FreeRTOS task on core 1 at high priority, running sensors → automation → relay every 1 s, with the cloud-loss manual cancel after 5 min.
    - `sensors.cpp`: 16-sample median ADC on ADC1, DHT cached at ≥2 s, rain debounced ×3.
    - `wifi_link.cpp`: 5 saved networks, strongest visible first, hidden SSIDs, exponential backoff, and classified provisioning failures (wrong password, not found, timeout).
    - `mqtt_link.cpp`: TLS with an optional embedded CA, LWT, retained status/reported, versioned desired apply with NVS persistence, all 6 commands with acks, a 50-reading offline buffer, and events that wait until they can be delivered.
    - `provisioning.cpp`: NimBLE GATT with all 5 characteristics, callbacks queue work to the loop, framed writes, scan results as notifications, a live state machine connecting_wifi → connecting_cloud → online/failed, and no_internet detected by DNS failure. Pairing opens at first boot (until configured), on a 5 s button hold, or by cloud command (2 min).
    - `storage.cpp` (NVS): networks, cloud, settings, calibration, and a claim code generated once that survives factory reset. Plus `status_led`, button handling (5 s pairing / 15 s factory reset) and a `timebase` using 64-bit monotonic ms (no millis() wrap).
  - `scripts/embed_config.py` generates the CA and fallback-broker header; nothing secret is committed.
  - `docs/HARDWARE.md`: parts, wiring table with reasons, the isolated pump circuit, solar power, first start, calibration, LED legend, safety behaviour, TLS.
- *Verified:* `py -3.14 firmware/test/run_native.py` gives **218 checks passed** (all 33 shared automation vectors, calibration, framing incl. UTF-8, desired parsing incl. hostile clamping, clock conversion). `platformio run -e esp32dev` gives **SUCCESS** from a clean build with zero warnings in our sources (RAM 17.9 %, flash 61.9 %, 1.2 MB image).
- *Blocked:* P7.11 (physical flashing, calibration, relay polarity check) needs the board. *Open:* P7.10 OTA (optional). Safe OTA needs signed images; to be revisited in Phase 9.

## 2026-09-24 — P8.1 Plant health backend
- *Changed:*
  - `modules/insights/provider.ts`: the `PlantHealthProvider` port (`name`, `version`, `evaluate(HealthInput)`) and a `ProviderRegistry` chain with fallback. The ML provider goes first and rules act as the safety net.
  - `insights/rules.ts`: `RuleBasedHealthProvider` v1 over hourly data. Findings (stable codes): dry_spells, waterlogging, pump_safety_stops, frequent_watering, heat_stress, moisture_unstable, sensor_gaps, moisture_on_target. The score starts at 100 with severity penalties; status healthy/attention/critical/unknown; human summaries.
  - `insights/service.ts` builds the input: the linked device, 7 days of hourly buckets straight from raw readings (new `hourlyFromRaw`) and pump sessions. It stores the `HealthReport`, raises a PLANT_HEALTH alert when critical, and returns history. A `runDue()` daily job (runtime checks every 6 h).
  - `modules/plants`: CRUD with ownership; delete unlinks devices and removes reports. Routes: `/plants`, `/plants/:id/health`, `/plants/:id/health/run`.
- *Verified:* 6 rule/registry unit tests and 4 plants int tests (CRUD/isolation, healthy report + history, critical → alert, daily job idempotent). Full backend suite green; lint clean.

## 2026-09-24 — P8.2 ML service + adapter
- *Changed:* `services/ml` (FastAPI): `POST /v1/health/predict` (Pydantic models mirroring the contract), `GET /healthz`, optional `x-ml-key` auth, a `HealthModel` protocol with `features()` extraction and a transparent `BaselineModel` placeholder (`MODEL` env selects the model), Dockerfile, requirements. `packages/shared/test-vectors/ml-contract.json` is the single request/response example both sides test against. Backend `insights/ml.ts` `MlHealthProvider`: builds the contract request, 10 s timeout, API key, Zod-validates the response, records `model@version`. Registered ahead of rules when `ML_SERVICE_URL` is set (env: `ML_API_KEY`, `ML_MODEL_NAME`), with automatic fallback to rules.
- *Verified:* pytest 5/5 (contract request accepted, response shape equals contract, full-week scoring, API key enforced). Backend unit 26/26 incl. 5 adapter contract tests (exact request, response parsing, 500/off-contract rejected, timeout, fallback). **Live cross-language check:** uvicorn service ↔ real Node adapter returned `baseline@0.1.0` healthy 98.9; a wrong key got 401. Lint clean.

## 2026-09-24 — P8.3 Photo uploads (flagged)
- *Changed:*
  - Backend `modules/media/storage.ts`: an `ObjectStorage` interface with the pre-signed URL pattern, implemented by `LocalDiskStorage`. HMAC-signed, expiring PUT/GET links; key whitelist regex plus path-traversal guard; magic-byte image sniffing (JPEG/PNG/WebP only, 5 MB). `media/routes.ts`: PUT/GET `/v1/media/*`, where the signature is the authorisation.
  - Plants: `POST /plants/:id/photos/upload-url` (10 min link) and `POST /plants/:id/photos` (`photoId`, `analyze`). Analyzing runs a health check carrying a signed image URL for image models. `plant.photoUrl` is always returned as a 24 h signed URL. The link base comes from `PUBLIC_URL` or the request's own host, so it works on whatever network the phone uses.
  - Shared schemas for all of it.
  - Mobile: `expo-image-picker` (permission copy in app.json), `features/insights/photoUpload.ts` (camera/library → signed PUT → attach), and a `PhotoCard` on Plant Health behind `flags.photoUpload`.
- *Fixes found while testing:* LineChart scrub gesture now `runOnJS(true)` (it only sets React state). Slider gesture callbacks explicitly `'worklet'`. A test leaked mock state. The remaining 8 gesture warnings come from gesture-handler's own ReanimatedSwipeable under the Jest worklets mock, not our code.
- *Verified:* backend photos int 7 (upload→attach→signed read, tampered 403, non-image 400, type mismatch 400, foreign plant 403, not-uploaded 400, other user 404, analyze carries the image URL) plus storage unit tests (expiry, traversal, sniffing). Mobile 21 suites / 108 tests. Typecheck and lint clean everywhere.

## 2026-09-24 — P8.4 ML integration guide
- *Changed:* `docs/ML_INTEGRATION.md`: architecture (provider port, registry fallback), the shared request/response contract field by field, finding codes and how to add new ones, a step-by-step model bring-up (features → training data export → implement `HealthModel` → register → test → deploy with `ML_SERVICE_URL`/`ML_API_KEY`), the image flow with signed URLs, and a contract-change checklist.
- *Verified:* documentation task; the referenced commands and paths exist and pass (pytest 5/5, backend 125).

## 2026-09-24 — P9.1 Security pass
- *Changed:*
  - `npm audit` went from 14 moderate advisories to only the accepted `decode-uri-component@0.2.2`. `uuid` is forced to ≥ 11.1.1. The decode-uri-component fix (0.5) was **tested and rejected**: it's ESM-only and breaks `query-string`'s `require()` (deep links), so it's pinned and documented.
  - MQTT payload caps: broker 16 KB, gateway 8 KB, with a test.
  - Firmware BLE: LE Secure Connections with bonding; `info`/`wifi_creds`/`cloud_creds` require an encrypted link; bonds are cleared on factory reset. The app retries the first encrypted read while the OS completes pairing.
  - `docs/SECURITY.md`: asset list, controls per layer, accepted risks with reasons, a production checklist.
- *Verified:* backend 126 tests; mqtt int 7/7 incl. the oversized drop; firmware build SUCCESS (no warnings in our sources); mobile typecheck and lint clean, 108 tests; Android export OK after the dependency changes; `query-string` parse verified.

## 2026-09-24 — P9.2 Observability
- *Changed:* `lib/metrics.ts`, a dependency-free Prometheus registry. Counters: HTTP requests by method/status class, MQTT messages by kind (accepted/dropped via a new gateway `onMessage` hook), bus listener errors, alerts raised by type. Gauges: MQTT connected, devices connected, uptime, heap. `GET /v1/metrics` is guarded by `METRICS_TOKEN` (or served only outside production). Existing: request IDs (`x-request-id`, honours incoming), structured pino logs with redaction, `/v1/health` deep check (db + mqtt, 503 when degraded).
- *Verified:* 3 metrics tests plus the realtime int test asserting MQTT telemetry is counted; backend 18 files / 129 tests; lint clean.

## 2026-09-24 — P9.3 CI
- *Changed:* `.github/workflows/ci.yml` with 4 jobs:
  - **node**: `npm ci`, cached MongoDB test binary, `turbo build typecheck lint test`, backend integration, backend e2e with the simulator.
  - **mobile-bundle**: expo-doctor plus `expo export --platform android`.
  - **firmware**: PlatformIO + ziglang, `run_native.py` (the shared automation vectors in C++), `pio run -e esp32dev`.
  - **ml**: pytest contract tests.
  - The repo moved to ESLint 9 everywhere (Expo's plugins declare ESLint ≤ 9 peers), so the dependency tree has zero invalid/missing entries.
- *Verified locally:* full turbo pipeline 15/15 tasks; lockfile consistent (`npm install --package-lock-only` produces no diff); `npm ls --all` clean; workflow YAML parses (4 jobs). GitHub itself can only run it once the repo is pushed (human).

## 2026-09-24 — P9.4 blocked, P9.5 Deployment config
- *P9.4 BLOCKED (🧑 HUMAN):* needs an Atlas cluster, a hosting account and secrets.
- *Changed:*
  - `apps/backend/Dockerfile` (multi-stage, workspace-filtered `npm ci`, prune, non-root user, healthcheck) and `.dockerignore`.
  - `fly.toml` for a single-host production setup: HTTPS API, the embedded MQTT broker exposed on 8883 with Fly TLS termination, one always-on machine, a volume for photos, and a health check. Devices get `mqtts://<app>.fly.dev:8883` from the claim, so nothing is hardcoded.
  - `docs/DEPLOY.md`: setup A (Fly + Atlas) and B (managed broker), ML service, the env var reference, EAS env for `EXPO_PUBLIC_API_URL`, the firmware CA, and the acceptance test.
- *Verified:*
  - The **production build** ran locally (`NODE_ENV=production node apps/backend/dist/server.js` with Mongo): health db+mqtt OK, Swagger and metrics hidden, register works, JSON logs.
  - The **Dockerfile npm steps were rehearsed** in a scratch copy: workspace `npm ci` → build shared+backend → prune (258 runtime packages, no dev tools) → the runtime imports resolve.
  - `fly.toml` parses. Docker itself isn't installed here, so the image build is verified at deploy time.

## 2026-09-24 — P9.6 blocked, P9.7 Docs
- *P9.6 BLOCKED (🧑 HUMAN):* the real-world acceptance test on home WiFi, another WiFi and mobile data (steps in docs/DEPLOY.md).
- *Changed:* README rewritten (what's inside, highlights, quick start incl. the simulated onboarding device, all test commands, doc index). `docs/MQTT.md` (connection, topics, shadow semantics, automation order, limits) and `docs/API.md` (endpoint overview, error codes, Socket.IO events), completing the docs listed in plan §5.

## 2026-09-24 — P7.10 OTA firmware updates
- *Changed:*
  - Shared: `ota` command type with an `https` url + `sha256` + version (refinement tested); `deviceCommandBody` excludes `ota`; `firmwareStatus`.
  - Backend: a release channel from env (all-or-nothing validation); `GET /devices/:id/firmware` (current/latest/updateAvailable) and `POST /devices/:id/firmware/update` (online-only, refuses the same version, 5/min).
  - Firmware `ota.cpp`: HTTPS download streamed into the OTA slot with incremental mbedtls SHA-256, activation only on match, the ack carries the result, reboot on success. The control task keeps running.
  - Simulator: simulated OTA (acks, reports the new version, reboots).
  - Mobile: `FirmwareRow` in Device Settings (version, "Update" badge, confirm dialog).
  - Docs: MQTT, DEPLOY (release steps, env), SECURITY (OTA guarantees and limits). ADR-015.
- *Verified:* shared 62; backend 19 files / 132 tests (OTA sends the release command, refuses offline/current/no-release, blocks client-supplied OTA URLs); simulator 11; mobile 22 suites / 110; firmware build SUCCESS (RAM 18.2 %, flash 63.3 %, 0 warnings in our code); native logic 218/218.

## 2026-09-24 — Final verification (all tasks done or human-blocked)
- Fresh run with no caches: turbo build/typecheck/lint/test **15/15**; backend integration **96**, e2e **7/7** (unit+int+e2e = 132); mobile **22 suites / 110 tests**, typecheck and lint clean, expo-doctor **21/21** (fixed an `@types/jest` SDK mismatch found in this pass), Android export 7.7 MB; shared **62**; simulator **11**; ML pytest **5/5**; firmware native **218/218** checks, ESP32 build SUCCESS; `npm ls --all` clean; `npm audit` shows only the documented accepted advisory.
- `npm run dev` smoke test: this PC's LAN address had changed since the first run (10.107.24.48 → 192.168.0.103) and the stack adapted automatically. The simulated device connected, applied its config and streamed data; health db+mqtt OK.
- **Remaining human steps** (§14): P6.15 Expo account + dev build on a phone; P7.11 flash and calibrate the real board; P9.4 cloud accounts (Atlas + Fly) and secrets; P9.6 real-world multi-network acceptance test. Step-by-step instructions are in docs/DEPLOY.md and docs/HARDWARE.md.

## 2026-10-01 — v2.1 Simple Mode planned (Phase 10, §15)
- The user wants it simpler: no sign-up, devices found automatically as Xeno 1/Xeno 2, WiFi handled automatically, colours unchanged. Plan updated with §15 (experience, honest limits, security model, ADR-016…019) and Phase 10 tasks P10.1–P10.12.
- Hotfix before this (commit aadc4e3): expo-notifications is lazy-loaded so the app no longer crashes in Expo Go on Android.

## 2026-10-01 — P10.1 + P10.2 Shared contracts and backend guest accounts
- *Changed:*
  - Shared: `userPublic.email` is nullable and has a `guest` flag; `upgradeBody`; BLE `info.mode` (`setup|rejoin`, default `setup`) with an optional claim code; BLE name prefix `Xeno-`; `nextDefaultDeviceName()`.
  - Backend: `POST /auth/guest` (5/min/IP) and `POST /auth/upgrade`; User email/password are optional with a partial unique index on email; login ignores password-less accounts; claim names devices `Xeno N` (lowest free number per owner).
  - Docs: API.md, SECURITY.md.
- *Verified:* shared 65; backend integration 102 (guest session, many guests, upgrade keeps the id and works once, email clash 409, needs auth, default naming incl. reuse and per-owner numbering), unit 29, e2e 7; mobile typecheck + 111 tests.

## 2026-10-01 — P10.3 Mobile invisible session
- *Changed:*
  - `lib/bootstrap.ts`: restore the session, or silently create a guest on first launch. The splash stays up meanwhile, so the welcome screen never flashes; single-flight.
  - The welcome screen only appears after sign-out or when the first launch is offline: "Get started" (guest) plus "I already have an account", with an offline banner.
  - The sign-up route is removed; the screen became "Save your garden" (`/save-garden`, upgrades the guest and keeps its devices).
  - Settings for guests: "Only on this phone", Save your garden, "Sign in with email" (with a warning), and a guest sign-out warning offering to save first.
- *Verified:* mobile typecheck + lint clean, 24 suites / 120 tests (bootstrap: first launch → guest without a signedOut flash, restore, offline fallback, no double guest; welcome start/offline; save garden; guest settings).

## 2026-10-01 — P10.4 Mobile WiFi memory
- *Changed:* `lib/wifi.ts`:
  - `wifiVault`: SecureStore JSON blob, newest 8 networks, tolerant of corrupt data, wiped on sign-out.
  - `currentPhoneWifi({ask})`: Android SSID via NetInfo after the location permission, with a plain-language rationale; null on mobile data, iOS, hidden SSIDs or refusal.
  - app.json declares ACCESS_FINE_LOCATION and ACCESS_WIFI_STATE.
- *Verified:* 8 new tests (round trip, recency order, forget, never in AsyncStorage, cap, corrupt data, permission ask/no-ask, unknown SSID, cellular, iOS); full mobile suite green.

## 2026-10-01 — P10.5 Auto-setup engine
- *Changed:*
  - `features/setup/autoSetup.ts`: discover → connect all, sequentially. New devices are claimed and given cloud + WiFi; rejoin devices get WiFi only when they're mine, and a stranger's device is skipped untouched.
  - Names are predicted with the server's rule (`Xeno N`), and rejoin devices keep their existing name.
  - WiFi choice order: last working network this run → phone's WiFi (if the device sees it and the password is known) → any visible saved network → ask once. The prompt reason covers first time, wrong password, and "the device can't see your phone's network" (5 GHz).
  - Passwords are saved only after the device proves them; wrong saved passwords are forgotten. Per-device failures and retry never block the other devices.
  - The mock transport now simulates several devices (`SIMULATED_DEVICES`, Xeno-DEM1/2) with per-device networks and rejoin behaviour.
- *Verified:* 10 engine tests (2 devices with zero prompts; one prompt reused + saved; wrong saved password; 5 GHz explanation; mobile-data fallback to a saved network; rejoin; stranger skipped; failure isolation + retry; name prediction; Bluetooth-off error). Onboarding tests still green.

## 2026-10-01 — P10.6 Auto-setup UI
- *Changed:*
  - `/setup` screen (full-screen modal): radar while looking, with a "can't find it?" hint after 15 s; a row per device with live plain-language steps, a spinner, a tick, or Retry; an inline one-time WiFi card (network chips from what the device sees, the password field, and a reason-specific message for first time / wrong password / 5 GHz); a celebration when done; "Set up manually instead" as a fallback.
  - The Garden screen gets `NearbyCard`: quiet discovery (only when no OS prompt is needed), "2 new devices nearby — Xeno 1, Xeno 2 → Connect", or "Tomatoes needs WiFi → Fix WiFi". The empty state is "Find my devices", and + opens `/setup`.
  - A shared controller (`useAutoSetup`), reset on Done and on sign-out.
  - Transports gain `canScanQuietly()`; the demo transport offers both simulated devices and stops showing ones already set up and online.
  - Fixed guests being greeted as "My".
  - No colour or token changes.
- *Verified:* mobile typecheck + lint clean; 27 suites / 144 tests (full screen flow with one prompt, zero-typing, password validation, wrong password then fix, NearbyCard shows/hides, Home empty state → /setup, guest greeting); Android export OK.

## 2026-10-01 — P10.7 Simpler everyday screens
- *Changed:*
  - Device cards have one-tap **Water now / Stop watering** (default duration within the safety limit; shows Starting…/Stopping… until the device confirms; disabled offline) and an **Auto** switch. The redundant mode badge is gone.
  - Device detail leads with the pump control, then the mode.
  - Plain words: "Signal: Good" (no dBm), "Software", "Device ID".
  - The test query client disables mutation GC timers, so Jest exits cleanly.
- *Verified:* typecheck + lint clean; 27 suites / 147 tests (card water → pump ON 600 s + Starting…, auto switch → manual, offline card can't water).

## 2026-10-01 — P10.8 Firmware simple mode (rejoin)
- *Changed:*
  - `xg_core/xg_pairing`, a pure policy: Setup when unconfigured or when the owner opened it; Rejoin after 2 min (`REJOIN_AFTER_MS`) with no saved WiFi working; Off otherwise. A blip restarts the clock.
  - `provisioning.cpp` is driven by the policy. `info` now carries `mode`, and the claim code is empty in rejoin. Cloud credentials are refused in rejoin. The mode never switches under a connected phone; the device lingers 15 s after online.
  - BLE name is `Xeno-XXXX` (`XG_BLE_NAME_PREFIX`); firmware 2.1.0.
  - Saved networks are only stored after a successful join, so rejoin can't erase them.
  - HARDWARE.md (first start, rejoin, LED) and the ARCHITECTURE diagram updated.
- *Verified:* native 234/234 (16 new pairing checks); ESP32 build SUCCESS (RAM 18.2 %, flash 63.3 %), no warnings in our code.

## 2026-10-01 — P10.9 Demo parity (works in Expo Go, end to end)
- *Changed:*
  - Simulator "virtual radio" (`apps/simulator/src/bridge.ts`, `--bridge-port/--bridge-state`): when the app sets up a demo device, the phone's simulated BLE session POSTs the claimed cloud credentials and the WiFi name. The simulator starts a matching virtual device on the real broker and remembers it across restarts (`.data/sim-bridge.json`). Zod-validated, 4 KB cap, credentials must name the device.
  - Mobile: `env.simBridgeUrl` (dev only, from `.env.local` or the Metro host); the mock session reports online only after the bridge accepts.
  - `npm run dev` starts the bridge on port 4100 and writes `EXPO_PUBLIC_SIM_BRIDGE_URL`.
  - Fixed: the demo claim codes contained "O", which is outside the claim-code alphabet, so demo claims had always been rejected (400). Now `DEMX2345`/`DEMX2346`.
- *Verified:*
  - Simulator 15 (4 bridge tests); mobile 28 suites / 152 (bridge handoff, bridge down → cloud_failed, no-bridge mode, already-set-up devices hidden, dev-only bridge URL).
  - **Live run:** `npm run dev` on this PC (LAN 10.107.23.12, detected automatically), then a script playing the phone: guest session → claimed `Xeno 1`/`Xeno 2` → bridge 200 → both **online with live soil readings** within seconds.

## 2026-10-01 — P10.11 One-command cloud deploy
- *Changed:* `npm run deploy:cloud -- --app <name>` (`tools/deploy.mjs`):
  - checks the Fly CLI and login (opens the browser login); creates the app and the `xg_data` volume only if missing;
  - generates the JWT + metrics secrets once and never overwrites them; asks only for the Atlas URI (or reads `$MONGO_URI`); secret values go through `fly secrets import` stdin and are never on the command line or in logs;
  - deploys with remote builders (no local Docker), sets `DEVICE_BROKER_HOST=<app>.fly.dev` automatically, and waits for `/v1/health`;
  - prints the next steps. `--dry-run` shows the plan.
  - DEPLOY.md now starts with a three-command quickest path.
- *Verified:* 7 `node --test` cases on the pure planner (fresh / re-run / host follows the app name / env URI skips the prompt / no secret values in the plan / invalid names / helpers), via `npm run test:tools`. The live CLI paths were checked for clear errors (no Fly CLI here; no app name).

## 2026-10-01 — P10.10 Local Android app build (no Expo account)
- *Changed:*
  - `npm run android:setup` (`tools/android/setup.ps1`): a portable Temurin JDK 17 plus the Android SDK (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, platform-tools) in `%LOCALAPPDATA%\xeno-android`. Idempotent and verifies every part.
  - `npm run android:apk` (`tools/android/build-apk.mjs`): `expo prebuild` (CNG; keeps our npm scripts), then `gradlew assembleDebug` (arm64 by default, `--all-abis` optional), then `dist/xeno-garden-dev.apk`. `--release --api https://<server>` builds the finished app with the public server address baked in.
  - Added `expo-dev-client`; applied Expo's current patch versions (@expo/ui, expo, expo-router, expo-constants); expo-doctor 21/21.
  - Fixed: the root `.gitignore` rule `android/` also hid `tools/android/`; it's now `apps/mobile/android/`.
- *Problems hit and fixed along the way:*
  - Licence answers piped from PowerShell never reached `sdkmanager.bat`, so the first setup silently installed nothing. It now uses a stdin file, a log file, and exit-code + folder checks.
  - `gradlew.bat` needs a full path under cmd.
  - The first full test run timed out under build CPU load; it passed when re-run alone.
- *Verified:* the APK built (first build 26 min, rebuild 7 min), 98 MB, `garden.xeno.app`, minSdk 24 / target 36, arm64, with BLUETOOTH_SCAN/CONNECT, ACCESS_FINE_LOCATION, ACCESS_WIFI_STATE and POST_NOTIFICATIONS (checked with `aapt dump badging`). Mobile 28 suites / 152 tests, typecheck + lint clean.

## 2026-10-01 — P10.12 Docs + full verification (v2.1 Simple Mode complete)
- *Docs:*
  - README gains "How to use it (simple mode)", the Expo Go demo with the virtual radio, the local APK, and "works on any internet".
  - ARCHITECTURE gains Flow 1b (simple mode).
  - Plan §7.4 updated (`Xeno-XXXX`, `info.mode`); DEPLOY quickest path; HARDWARE rejoin; API/SECURITY guest accounts.
  - §14 human steps rewritten (no Expo account needed any more).
- *Fix found in this pass:* a backend unit test timed out under full parallel load (5 s default); unit tests now get 20 s, like int/e2e.
- *Verified with no caches:*
  - turbo build/typecheck/lint/test **15/15**; backend integration **102**, e2e **7**;
  - mobile **28 suites / 152 tests**, expo-doctor **21/21**, Android export OK, local APK built;
  - simulator **15**; shared **65**; tools **7**; ML pytest **5/5**;
  - firmware native **234/234**, ESP32 build SUCCESS (RAM 18.2 %, flash 63.3 %);
  - `npm ls` clean; `npm audit` shows only the documented, accepted `decode-uri-component` advisory;
  - live `npm run dev` + phone-role script: guest → Xeno 1/Xeno 2 online with data.
- **Remaining human steps:**
  - P6.15: install `dist/xeno-garden-dev.apk`.
  - P7.11: flash and calibrate the board.
  - P9.4: Atlas + Fly accounts, then `npm run deploy:cloud`.
  - P9.6: build the release APK and test on three networks.

## 2026-10-03 — Real hardware bring-up (board xg-68fe710c5414), all verified on the device
- *Found and fixed on the real ESP32:*
  1. The BLE info JSON used `.c_str()` of a temporary, so phones read garbage ("Code point out of bounds").
  2. A stored claim code from older firmware wasn't valid; it's now regenerated. The app also checks the code and asks for a re-flash.
  3. The DHT library tripped the interrupt watchdog with no sensor attached, rebooting the board every ~30 s. Replaced with an own reader with µs timeouts (`xg_dht`, host-tested).
  4. A device on WiFi but unable to reach its server stayed invisible. It now returns to setup mode after 1 min, and to rejoin mode after 1 min without WiFi.
  5. The dev server handed devices a stale LAN address after the PC changed network. Now `DEVICE_BROKER_HOST=auto` uses the address the phone used; the app finds the dev server via Metro; `npm run dev` refuses to start twice.
  6. BLE pairing keys went stale after resets, breaking every later setup. Firmware 2.1.4 uses no BLE pairing (trade-off documented in SECURITY.md).
  7. "Your phone is offline" was misleading; the message now names the server address and the fix.
  8. Mock data is gone by default: `npm run dev` runs real devices only (`dev:demo` for the simulator), and the app shows simulated devices only when demo mode is explicitly on.
- *Verified on hardware* with `tools/hil/full_setup.py`, twice back to back on firmware 2.1.4: guest → BLE info → claim → cloud + WiFi creds → online on T5-018 → readings (real DHT 25.8 °C / 93 %) → **pump ON confirmed by the board in 0.5 s, OFF in 0.5 s** → reset. Firmware native 246/246, ESP32 build OK, backend 32 unit + 103 int + 7 e2e, mobile 156.

## 2026-10-03 — Sensor fixes from the user's bench test (firmware 2.2.0, installed over WiFi)
- **Rain always "yes":** GPIO27 sat LOW on the user's module (99 % of readings). `xg::RainDetector` learns the dry level at power-on, so rain is reported only when the level changes. It handles either polarity, and an idle-low or unconnected module reads "no rain". Host-tested.
- **Soil stuck at 0 %:** the sensor works (stable raw ~3870, i.e. powered from 5 V), but the 3.3 V defaults (dry 3000) clamped everything to 0 %. `xg::widenSoilRange` widens an uncalibrated range to the real readings (saved at most once a minute; measured ends are never touched). Telemetry now also sends `soilRaw` when it's out of range, for diagnosing wiring.
- **Default mode is now Manual** (backend `initialDesired`, firmware default + NVS default, simulator). Manual commands already win over Auto in `xg::evaluate`.
- **USB serial on the bench is corrupt** (bit 0 flips: `0xC0` arrives as `0xC1`), so esptool can't connect at any baud rate. `npm run dev` now serves the built firmware over HTTPS (self-signed cert, SHA-256-verified on the device) as the server's firmware release. The board was updated 2.1.4 → 2.2.0 over WiFi.
- *Verified on the real board after the update:* rain=false, mode manual/idle, soil raw 3863–3872 → 0–0.2 %, DHT 25.8 °C / 81 %, pump ON in 0.67 s / OFF in 0.68 s. Firmware native 276/276, ESP32 build OK, backend 32 unit + 103 int + 7 e2e, simulator 16, tools 7, lint clean.

## 2026-10-07 — Plant Scan (branch ML-INTEGRATE-V.0.2.1, uncommitted: the user commits by hand)
- **Feature.** Scan tab → camera/gallery (permission handling, square crop) → preview + garden link → upload (signed URL) → disease model → result. The result has the condition, crop, confidence bar, severity, treatment steps, prevention, alternatives, and **sensor tips** from the linked Xeno device (humidity, soil, rain, heat). The latest scan shows on the Garden dashboard.
- **Model plug.** `SCAN_API_*` in `apps/backend/.env`.
  - *Presets:* generic, huggingface, roboflow, kindwise, xeno-ml.
  - *Request formats:* 4 (multipart, base64 JSON, raw bytes, base64 form).
  - *Responses:* read automatically; dot-path overrides for unusual APIs.
  - *Labels:* any wording maps to a 30-condition catalogue with advice.
  - *Failures:* clear messages per case (bad key, quota, cold start, timeout, unreadable).
  - *Safety:* the key is never logged or sent to the phone, and a broken config never stops the server.
- **Local stand-in model.** `services/ml` `POST /v1/scan/predict` runs the ONNX MobileNetV2 PlantVillage model (`python -m app.fetch_model`, 9 MB, git-ignored). `npm run dev` starts it automatically when no API is configured. On 60 real PlantVillage photos, the full chain (model → matcher) got the right condition on 54/60 (90 %). 4 of the 6 misses were shown as "Not sure", and only 2 were confidently wrong (look-alike diseases).
- **Irrigation untouched.**
  - Code is additive only: a new backend module and collection `plant_scans`, a new mobile feature, a tab and a dashboard card behind `flags.plantScan`.
  - Existing files changed by one or two lines each: module registration, 2 error codes, a shared export, the scans endpoint group, query keys, an optional per-request timeout in the API client, and the tab/dashboard hooks.
- **Incident, fixed.** `import { models } from 'mongoose'` passed vitest but crashed the real server at startup (no such named ESM export). The running dev server hot-reloaded it and stayed down until the fix. The board was already offline (last seen 19:49 UTC), so no device was affected. New guard: `test/unit/realNodeImports.test.ts` loads every module under real Node; it fails on the original bug.
- **Verified.**
  - Backend: unit 132, int 109 (6 new, including a real HTTP model server per API style), e2e 7.
  - Other suites: shared 65, simulator 16, tools 7, ML pytest 7 (+1 skipped by design), mobile 167 (11 new); lint and types clean.
  - Live: the server plus the local model, with a real tomato late-blight photo → "Late blight · Tomato · 99.9 % · high · 3 treatment steps" in 36 ms (first call 386 ms).
