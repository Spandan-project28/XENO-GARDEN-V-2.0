# REST + realtime API (v1)

The complete, always-current reference is **Swagger at `/docs`** (development) and the OpenAPI JSON at `/docs/json`. Both are generated from the same Zod schemas the app uses (`packages/shared`). This page is the overview.

Base URL: `https://<host>/v1`. JSON everywhere. Auth: `Authorization: Bearer <accessToken>` except where noted.
Errors always look like `{"error": {"code": "…", "message": "…", "details"?: …}}`.

| Area | Endpoints |
|---|---|
| Auth *(public)* | `POST /auth/guest` (silent first-launch account, 5/min/IP) · `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` (rotating) · `POST /auth/logout` |
| Auth *(bearer)* | `POST /auth/upgrade` `{email, password, name}`: turns the current guest into an email account, keeping its devices |
| Me | `GET/PATCH /me` · `POST/DELETE /me/push-tokens` · `GET/PUT /me/notification-prefs` |
| Devices | `POST /devices/claim` → `{device, mqtt}` (default name: the lowest free `Xeno N`) · `GET /devices` · `GET/PATCH/DELETE /devices/:id` |
| Control | `PUT /devices/:id/settings` (partial) · `PUT /devices/:id/mode` · `POST /devices/:id/pump` `{action, durationSec?}` · `POST /devices/:id/commands` `{type}` |
| History | `GET /devices/:id/readings?from&to&resolution=auto\|raw\|5m\|1h\|1d&tz` · `GET /devices/:id/pump-events?from&to` |
| Alerts | `GET /alerts?status=open,acknowledged&deviceId&cursor&limit` · `GET /alerts/counts` · `POST /alerts/:id/ack` · `POST /alerts/:id/resolve` |
| Plants & health | `GET/POST /plants` · `PATCH/DELETE /plants/:id` · `GET /plants/:id/health` · `POST /plants/:id/health/run` · `POST /plants/:id/photos/upload-url` · `POST /plants/:id/photos` |
| Media *(signed URL)* | `PUT/GET /media/*?exp&sig` |
| System *(public)* | `GET /health` · `GET /metrics` (token) |

Notable error codes: `VALIDATION_FAILED` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404, also returned for other users' resources), `DEVICE_ALREADY_CLAIMED` (409), `DEVICE_OFFLINE` (409, pump commands need an online device), `RATE_LIMITED` (429).

## Realtime (Socket.IO)

Connect to namespace **`/rt`** with `auth: { token: <accessToken> }`.

| Direction | Event | Payload |
|---|---|---|
| client → server | `subscribe` | `{deviceId}` → ack `{ok: true, device}` or `{ok: false, error}` |
| client → server | `unsubscribe` | `{deviceId}` |
| server → client | `telemetry` | reading + `deviceId`, `at` |
| server → client | `shadow` | `{deviceId, desired?, reported?}` |
| server → client | `status` | `{deviceId, online, at}` (all of the user's devices) |
| server → client | `device_event`, `cmd_ack` | device events / command acks |
| server → client | `alert` | `{alert}` when an alert opens or changes |
| server → client | `device_removed` | `{deviceId}` |

Types: `packages/shared/src/realtime`.
