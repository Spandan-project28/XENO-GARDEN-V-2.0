#include "xg_shadow.h"

#include <ArduinoJson.h>
#include <string.h>

#include "xg_contract.h"

namespace xg {

DeviceSettings defaultSettings() {
  DeviceSettings s;
  s.moistureLow = XG_DEFAULT_MOISTURE_LOW;
  s.moistureHigh = XG_DEFAULT_MOISTURE_HIGH;
  s.maxPumpRunSec = XG_DEFAULT_MAX_PUMP_RUN_SEC;
  s.cooldownSec = XG_DEFAULT_COOLDOWN_SEC;
  s.rainLockout = XG_DEFAULT_RAIN_LOCKOUT;
  s.highTempC = XG_DEFAULT_HIGH_TEMP_C;
  s.telemetryIntervalSec = XG_DEFAULT_TELEMETRY_SEC;
  return s;
}

template <typename T>
static T clampv(T v, T lo, T hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

void clampSettings(DeviceSettings& s) {
  s.moistureLow = clampv(s.moistureLow, 0.0f, 100.0f - XG_MOISTURE_MIN_GAP);
  s.moistureHigh = clampv(s.moistureHigh, s.moistureLow + XG_MOISTURE_MIN_GAP, 100.0f);
  s.maxPumpRunSec = clampv<int32_t>(s.maxPumpRunSec, XG_MAX_PUMP_RUN_MIN, XG_MAX_PUMP_RUN_MAX);
  s.cooldownSec = clampv<int32_t>(s.cooldownSec, XG_COOLDOWN_MIN, XG_COOLDOWN_MAX);
  s.highTempC = clampv(s.highTempC, 20.0f, 60.0f);
  s.telemetryIntervalSec = clampv<int32_t>(s.telemetryIntervalSec, XG_TELEMETRY_MIN, XG_TELEMETRY_MAX);
}

Settings toAutomationSettings(const DeviceSettings& s) {
  Settings a;
  a.moistureLow = s.moistureLow;
  a.moistureHigh = s.moistureHigh;
  a.maxPumpRunSec = s.maxPumpRunSec;
  a.cooldownSec = s.cooldownSec;
  a.rainLockout = s.rainLockout;
  return a;
}

static bool readSettings(JsonObjectConst o, DeviceSettings& s) {
  if (!o["moistureLow"].is<float>() || !o["moistureHigh"].is<float>() || !o["maxPumpRunSec"].is<int>() ||
      !o["cooldownSec"].is<int>() || !o["rainLockout"].is<bool>()) {
    return false;
  }
  s.moistureLow = o["moistureLow"].as<float>();
  s.moistureHigh = o["moistureHigh"].as<float>();
  s.maxPumpRunSec = o["maxPumpRunSec"].as<int32_t>();
  s.cooldownSec = o["cooldownSec"].as<int32_t>();
  s.rainLockout = o["rainLockout"].as<bool>();
  s.highTempC = o["highTempC"] | static_cast<float>(XG_DEFAULT_HIGH_TEMP_C);
  s.telemetryIntervalSec = o["telemetryIntervalSec"] | XG_DEFAULT_TELEMETRY_SEC;
  clampSettings(s);
  return true;
}

bool parseDesired(const char* json, size_t len, Desired& out, std::string& error) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json, len);
  if (err) {
    error = std::string("json: ") + err.c_str();
    return false;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (!root["version"].is<uint32_t>()) {
    error = "missing version";
    return false;
  }
  out.version = root["version"].as<uint32_t>();

  const char* mode = root["mode"] | "";
  if (strcmp(mode, "auto") == 0) out.mode = Mode::Auto;
  else if (strcmp(mode, "manual") == 0) out.mode = Mode::Manual;
  else {
    error = "bad mode";
    return false;
  }

  if (!readSettings(root["settings"], out.settings)) {
    error = "bad settings";
    return false;
  }

  memset(&out.manual, 0, sizeof(out.manual));
  JsonVariantConst m = root["manual"];
  if (!m.isNull()) {
    const char* cmdId = m["cmdId"] | "";
    const char* pump = m["pump"] | "";
    if (strlen(cmdId) < 4 || strlen(cmdId) > 40 || (strcmp(pump, "ON") != 0 && strcmp(pump, "OFF") != 0) ||
        !m["durationSec"].is<int>() || !m["expiresAt"].is<int64_t>()) {
      error = "bad manual";
      return false;
    }
    out.manual.present = true;
    strncpy(out.manual.cmdId, cmdId, sizeof(out.manual.cmdId) - 1);
    out.manual.pump = strcmp(pump, "ON") == 0 ? PumpAction::On : PumpAction::Off;
    out.manual.durationSec = m["durationSec"].as<int32_t>();
    out.manual.issuedAt = m["issuedAt"] | static_cast<int64_t>(0);
    out.manual.expiresAt = m["expiresAt"].as<int64_t>();
  }
  return true;
}

ManualCommand manualToLocal(const DesiredManual& m, int64_t monoNowMs, int64_t epochNowMs) {
  ManualCommand c;
  memset(&c, 0, sizeof(c));
  if (!m.present) return c;
  int64_t remaining =
      epochNowMs > 0 ? m.expiresAt - epochNowMs : static_cast<int64_t>(m.durationSec) * 1000;
  // Never trust a remaining time longer than the command's own duration (clock skew).
  const int64_t maxRemaining = static_cast<int64_t>(m.durationSec) * 1000;
  if (remaining > maxRemaining) remaining = maxRemaining;
  if (remaining <= 0) return c;
  c.active = true;
  strncpy(c.cmdId, m.cmdId, sizeof(c.cmdId) - 1);
  c.pump = m.pump;
  c.expiresAt = monoNowMs + remaining;
  return c;
}

std::string settingsToJson(const DeviceSettings& s) {
  JsonDocument doc;
  doc["moistureLow"] = s.moistureLow;
  doc["moistureHigh"] = s.moistureHigh;
  doc["maxPumpRunSec"] = s.maxPumpRunSec;
  doc["cooldownSec"] = s.cooldownSec;
  doc["rainLockout"] = s.rainLockout;
  doc["highTempC"] = s.highTempC;
  doc["telemetryIntervalSec"] = s.telemetryIntervalSec;
  std::string out;
  serializeJson(doc, out);
  return out;
}

bool settingsFromJson(const std::string& json, DeviceSettings& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  return readSettings(doc.as<JsonObjectConst>(), out);
}

}  // namespace xg
