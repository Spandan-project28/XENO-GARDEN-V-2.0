# Dev Mosquitto

Create the password file (not committed) before `docker compose up`:

```sh
docker run --rm -v "$PWD/infra/mosquitto:/m" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /m/passwd xg-backend "<backend-password>"
```

Device accounts are named after the device `hardwareId`. Add them with `mosquitto_passwd -b /m/passwd <hwId> <pw>`.
In local dev without Docker, the backend can run an embedded aedes broker instead (`MQTT_EMBEDDED=true`).
