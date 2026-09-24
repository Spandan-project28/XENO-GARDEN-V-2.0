#pragma once
// Mirror of the cross-boundary constants in packages/shared/src/constants and ble/.
// If you change one side, change the other (the native tests check the automation rules
// against packages/shared/test-vectors/automation.json).

#define XG_MQTT_ROOT "xg/v1"

#define XG_BLE_NAME_PREFIX "XenoGarden-"
#define XG_BLE_SERVICE_UUID "6b1f0001-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_CHAR_INFO "6b1f0002-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_CHAR_WIFI_SCAN "6b1f0003-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_CHAR_WIFI_CREDS "6b1f0004-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_CHAR_CLOUD_CREDS "6b1f0005-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_CHAR_STATE "6b1f0006-5e6a-4c2b-9d3e-8a7c1b2f4e10"
#define XG_BLE_PROTOCOL_VERSION 1

#define XG_CLAIM_CODE_ALPHABET "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// Settings limits (SETTINGS_LIMITS) — the device clamps anything it receives.
#define XG_MOISTURE_MIN_GAP 5
#define XG_MAX_PUMP_RUN_MIN 30
#define XG_MAX_PUMP_RUN_MAX 3600
#define XG_COOLDOWN_MIN 30
#define XG_COOLDOWN_MAX 7200
#define XG_TELEMETRY_MIN 2
#define XG_TELEMETRY_MAX 300

// DEFAULT_SETTINGS
#define XG_DEFAULT_MOISTURE_LOW 30
#define XG_DEFAULT_MOISTURE_HIGH 45
#define XG_DEFAULT_MAX_PUMP_RUN_SEC 600
#define XG_DEFAULT_COOLDOWN_SEC 300
#define XG_DEFAULT_RAIN_LOCKOUT true
#define XG_DEFAULT_HIGH_TEMP_C 38
#define XG_DEFAULT_TELEMETRY_SEC 5

// Soil raw values pinned at an ADC rail mean a disconnected/shorted sensor.
#define XG_SOIL_RAW_FAULT_LOW 50
#define XG_SOIL_RAW_FAULT_HIGH 4050
