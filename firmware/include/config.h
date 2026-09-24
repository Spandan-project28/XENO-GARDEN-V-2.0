#pragma once
// Hardware + timing configuration. NO network secrets here: WiFi and broker credentials are
// provisioned over Bluetooth by the app and stored in NVS (flash).

#define XG_FW_VERSION "2.0.0"

// ── Pins (ESP32 DevKit) ──────────────────────────────────────────────────────
#define PIN_DHT 4            // DHT11/DHT22 data
#define PIN_SOIL 34          // capacitive soil sensor, analog (ADC1 — works while WiFi is on)
#define PIN_RAIN 27          // rain sensor digital out, active LOW (INPUT_PULLUP)
#define PIN_RELAY 26         // pump relay input
#define RELAY_ACTIVE_LOW 1   // most relay modules switch ON when the input is LOW
#define PIN_LED 2            // on-board status LED
#define PIN_BUTTON 0         // BOOT button (active LOW)

#define DHT_TYPE DHT11       // change to DHT22 if you use the more precise sensor

// ── Timing ───────────────────────────────────────────────────────────────────
#define CONTROL_TICK_MS 1000          // automation + safety loop
#define DHT_MIN_INTERVAL_MS 2000      // DHT sensors can't be read faster
#define REPORTED_HEARTBEAT_MS 60000
#define SOIL_SAMPLES 16

#define PAIRING_WINDOW_MS (120UL * 1000UL)
#define BUTTON_PAIRING_HOLD_MS 5000
#define BUTTON_FACTORY_RESET_HOLD_MS 15000

#define WIFI_ATTEMPT_TIMEOUT_MS 15000
#define WIFI_BACKOFF_MIN_MS 5000
#define WIFI_BACKOFF_MAX_MS (5UL * 60UL * 1000UL)
#define MQTT_BACKOFF_MIN_MS 2000
#define MQTT_BACKOFF_MAX_MS 60000
#define MQTT_KEEPALIVE_SEC 15
#define MQTT_SOCKET_TIMEOUT_SEC 4

/** Cancel an active manual command if the cloud has been unreachable this long. */
#define MANUAL_CLOUD_LOSS_CANCEL_MS (5UL * 60UL * 1000UL)

#define TELEMETRY_BUFFER 50           // readings kept while offline, flushed on reconnect
#define MAX_SAVED_NETWORKS 5

// Default calibration for a typical capacitive v1.2 sensor at 3.3 V / 11 dB attenuation.
#define SOIL_DEFAULT_DRY_RAW 3000
#define SOIL_DEFAULT_WET_RAW 1300
