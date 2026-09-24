#pragma once
// C++ port of packages/shared/src/automation (evaluateAutomation + rawToMoisture).
// Pure logic: no Arduino headers, so it compiles and is tested on the host too.
#include <stdint.h>

namespace xg {

enum class Mode : uint8_t { Auto, Manual };
enum class PumpAction : uint8_t { On, Off };

enum class Reason : uint8_t {
  MaxRuntime,
  Manual,
  ManualOff,
  Idle,
  SensorFault,
  Rain,
  Cooldown,
  Dry,
  Wet,
  Hold,
};

/** Wire name, e.g. "max_runtime" (matches PUMP_REASONS in the shared package). */
const char* reasonName(Reason r);
bool reasonFromName(const char* s, Reason& out);

struct Settings {
  float moistureLow;
  float moistureHigh;
  int32_t maxPumpRunSec;
  int32_t cooldownSec;
  bool rainLockout;
};

struct ManualCommand {
  bool active;
  char cmdId[41];
  PumpAction pump;
  int64_t expiresAt;  // same clock as `now`
};

struct Input {
  int64_t now;
  Mode mode;
  Settings settings;
  bool soilValid;
  float soilMoisture;
  bool rain;
  bool pumpOn;
  int64_t pumpSince;
  bool cooling;          // cooldownUntil != null
  int64_t cooldownUntil;
  ManualCommand manual;  // manual.active == false means null
};

struct Output {
  bool pumpOn;
  Reason reason;
  int64_t pumpSince;
  bool cooling;
  int64_t cooldownUntil;
  ManualCommand manual;
};

Output evaluate(const Input& in);

/** Raw ADC → moisture %. Returns false for a faulty sensor or unusable calibration. */
bool rawToMoisture(int raw, int dryRaw, int wetRaw, float& out);

/** Median of an int array (sorts a copy). n <= 32. */
int median(const int* values, int n);

}  // namespace xg
