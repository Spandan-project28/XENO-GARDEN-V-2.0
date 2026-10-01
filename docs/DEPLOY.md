# Deploying Xeno Garden v2

Goal: the phone app and the device reach the backend from **any network**, and nobody ever types an IP address. That means the backend needs a public HTTPS address, and devices need a public MQTT address. Both are given to the device automatically when it's claimed.

There are two supported setups. **A** is the simplest.

---

## Quickest path (one command, then one APK)

**You need two free accounts:**
- **MongoDB Atlas**: create an M0 cluster and a database user, allow network access from `0.0.0.0/0`, then copy the connection string.
- **Fly.io**: a card is required, but a small always-on machine costs a few dollars a month.

Then:

```sh
npm run deploy:cloud -- --app xeno-garden-<yourname>     # logs in, creates everything, asks for the Atlas string, deploys
npm run android:setup                                     # once: Java + Android SDK on this PC (no Expo account)
npm run android:apk -- --release --api https://xeno-garden-<yourname>.fly.dev
```

Install `dist/xeno-garden.apk` on every phone. It now works on any WiFi or mobile data. `npm run deploy:cloud -- --app … --dry-run` shows what it would do without changing anything; re-running it never overwrites existing secrets.

The sections below explain the same steps by hand.

## A. One server (Fly.io): API + built-in MQTT broker

Everything runs in one small always-on machine. `fly.toml` is ready in the repo root.

**You need:** a Fly.io account (card required), and a MongoDB Atlas free cluster (M0).

1. **Database.** Create an Atlas M0 cluster, a database user, and allow network access from `0.0.0.0/0`, or Fly's egress IPs if you use static ones. Copy the connection string, e.g. `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/xeno_garden`.
2. **App.**
   ```sh
   fly auth login
   fly launch --no-deploy --copy-config --dockerfile apps/backend/Dockerfile   # keep the name or change it in fly.toml
   fly volumes create xg_data --size 1                                        # photo storage
   fly secrets set \
     MONGO_URI='mongodb+srv://…' \
     JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
     METRICS_TOKEN="$(openssl rand -hex 24)"
   fly deploy
   ```
   If you renamed the app, update `DEVICE_BROKER_HOST` in `fly.toml` to `<your-app>.fly.dev`.
3. **Check it:** `curl https://<your-app>.fly.dev/v1/health` should return `{"ok":true,…,"checks":{"db":true,"mqtt":true}}`.
4. **Firmware TLS.** Fly serves a Let's Encrypt certificate on port 8883. Save the **ISRG Root X1** PEM as `firmware/certs/ca.pem` (from letsencrypt.org/certificates), then build and flash (`pio run -e esp32dev -d firmware -t upload`).
5. **App build.** Point the app at the server, then build:
   ```sh
   cd apps/mobile
   npx eas-cli@latest init                       # creates the EAS project (also enables push)
   npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<your-app>.fly.dev --visibility plaintext
   npx eas-cli@latest build --profile production --platform android
   ```
   For quick testing, use `--profile preview` (installable APK) instead.

That's it. Claiming a device returns `mqtts://<your-app>.fly.dev:8883` plus fresh credentials, and the app hands them to the device over Bluetooth.

> Why "always on": the MQTT broker keeps device connections in memory. `fly.toml` pins one machine with `auto_stop_machines = "off"`. Don't scale above one machine with the embedded broker; use setup B for that.

## B. Separate managed MQTT broker (EMQX / HiveMQ / Mosquitto)

Use this when you want several API instances, or already run a broker.

- Host the API anywhere that runs a container **continuously**: Railway, Fly, Render *paid*, a VPS. (Render's free tier sleeps, so it's not suitable.)
- Set `MQTT_EMBEDDED=false`, `MQTT_URL=mqtts://broker:8883`, `MQTT_USERNAME`/`MQTT_PASSWORD` (a service account with `xg/v1/#`).
- Devices must be allowed to log in with username = hardware ID and the password issued at claim. Configure the broker to authenticate against the backend (HTTP auth hook) or create users from the claim flow. Apply the per-device ACL from `infra/mosquitto/acl`.
- Set `DEVICE_BROKER_HOST/PORT/TLS` to the broker's public address, and put the broker's root CA in `firmware/certs/ca.pem`.

## Optional: plant-health model service

```sh
cd services/ml && docker build -t xeno-ml . && docker run -p 8000:8000 -e ML_API_KEY=... xeno-ml
```
Then set on the API: `ML_SERVICE_URL=https://ml.example.com`, `ML_API_KEY=...`, `ML_MODEL_NAME=baseline`. See `docs/ML_INTEGRATION.md`.

## Environment reference (API)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | ✔ | | MongoDB connection string |
| `JWT_ACCESS_SECRET` | ✔ | | ≥ 32 chars; placeholder values are rejected in production |
| `PORT` | | 4000 | HTTP port |
| `MQTT_EMBEDDED` | | true | Run the built-in broker |
| `MQTT_EMBEDDED_PORT` | | 1883 | Its port |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | when not embedded | | External broker |
| `DEVICE_BROKER_HOST`, `DEVICE_BROKER_PORT`, `DEVICE_BROKER_TLS` | ✔ in prod | localhost/1883/false | What devices connect to (sent at claim) |
| `PUBLIC_URL` | | request host | Public origin for signed photo URLs, behind proxies |
| `CORS_ORIGINS` | | (none) | Browser origins allowed |
| `UPLOAD_DIR` | | ./uploads | Photo storage (use a persistent volume) |
| `METRICS_TOKEN` | | | Enables `/v1/metrics` in production |
| `ALERT_LOW_MOISTURE_MINUTES` | | 10 | Dry-soil alert delay |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | | true / – | Push notifications |
| `ML_SERVICE_URL`, `ML_API_KEY`, `ML_MODEL_NAME` | | – | Plant-health model service |
| `FIRMWARE_LATEST_VERSION`, `FIRMWARE_LATEST_URL`, `FIRMWARE_LATEST_SHA256` | | – | OTA release channel (all three together; HTTPS URL, lowercase SHA-256) |

## Releasing firmware (OTA)

1. Bump `XG_FW_VERSION` in `firmware/include/config.h` and build: `pio run -d firmware -e esp32dev`.
2. Upload `firmware/.pio/build/esp32dev/firmware.bin` to any HTTPS file host (GitHub Releases, S3/R2, your server).
3. `sha256sum firmware.bin`, then set `FIRMWARE_LATEST_VERSION/URL/SHA256` on the API and restart.
4. The app shows **Update** under Device → Settings → Firmware.

## Acceptance test (the core promise)

With the production app installed and a device set up:

1. Phone on **home WiFi**: live readings update, and "Water now" runs the pump within a couple of seconds.
2. Phone on **mobile data** (WiFi off): same result.
3. Move the device to **another WiFi** (Settings → Change WiFi network): it comes back online without reflashing.
4. Unplug the router for 5 minutes: the device keeps watering on schedule, the app shows it offline plus an alert, and it recovers when the router is back.
