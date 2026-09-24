#pragma once
// Desired-state parsing and settings (de)serialisation. Pure (ArduinoJson only) → host-testable.
#include <stdint.h>

#include <string>

#include "xg_automation.h"

namespace xg {

struct DeviceSettings {
  float moistureLow;
  float moistureHigh;
  int32_t maxPumpRunSec;
  int32_t cooldownSec;
  bool rainLockout;
  float highTempC;
  int32_t telemetryIntervalSec;
};

DeviceSettings defaultSettings();
/** Clamps every field into the shared limits (the device never trusts input blindly). */
void clampSettings(DeviceSettings& s);
Settings toAutomationSettings(const DeviceSettings& s);

struct DesiredManual {
  bool present;
  char cmdId[41];
  PumpAction pump;
  int32_t durationSec;
  int64_t issuedAt;   // epoch ms (server clock)
  int64_t expiresAt;  // epoch ms
};

struct Desired {
  uint32_t version;
  Mode mode;
  DeviceSettings settings;
  DesiredManual manual;
};

/** Parses xg/v1/{hw}/desired. Returns false (and an error) on anything malformed. */
bool parseDesired(const char* json, size_t len, Desired& out, std::string& error);

/**
 * Converts a desired manual command to the device's monotonic clock.
 * `epochNowMs` = 0 when the device clock isn't synced (then durationSec is used as-is).
 * Returns an inactive command if it has already expired.
 */
ManualCommand manualToLocal(const DesiredManual& m, int64_t monoNowMs, int64_t epochNowMs);

std::string settingsToJson(const DeviceSettings& s);
bool settingsFromJson(const std::string& json, DeviceSettings& out);

}  // namespace xg
