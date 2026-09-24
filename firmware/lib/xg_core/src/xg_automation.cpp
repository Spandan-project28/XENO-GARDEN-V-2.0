#include "xg_automation.h"

#include <math.h>
#include <string.h>

#include "xg_contract.h"

namespace xg {

static const char* const kReasonNames[] = {
    "max_runtime", "manual", "manual_off", "idle", "sensor_fault",
    "rain",        "cooldown", "dry",      "wet",  "hold",
};

const char* reasonName(Reason r) { return kReasonNames[static_cast<int>(r)]; }

bool reasonFromName(const char* s, Reason& out) {
  for (int i = 0; i < 10; i++) {
    if (strcmp(s, kReasonNames[i]) == 0) {
      out = static_cast<Reason>(i);
      return true;
    }
  }
  return false;
}

Output evaluate(const Input& in) {
  const Settings& s = in.settings;
  const int64_t now = in.now;

  ManualCommand manual = in.manual;
  if (manual.active && now >= manual.expiresAt) manual.active = false;

  bool cooling = in.cooling && now < in.cooldownUntil;
  int64_t cooldownUntil = cooling ? in.cooldownUntil : 0;

  auto finish = [&](bool pumpOn, Reason reason) {
    Output o;
    o.pumpOn = pumpOn;
    o.reason = reason;
    o.pumpSince = pumpOn == in.pumpOn ? in.pumpSince : now;
    o.cooling = cooling;
    o.cooldownUntil = cooldownUntil;
    o.manual = manual;
    return o;
  };

  // 1. Hard safety: nothing may run the pump longer than maxPumpRunSec.
  if (in.pumpOn && now - in.pumpSince >= static_cast<int64_t>(s.maxPumpRunSec) * 1000) {
    cooling = true;
    cooldownUntil = now + static_cast<int64_t>(s.cooldownSec) * 1000;
    manual.active = false;
    return finish(false, Reason::MaxRuntime);
  }

  // 2. An unexpired manual command wins over the mode (ON refused while cooling down).
  if (manual.active) {
    if (manual.pump == PumpAction::Off) return finish(false, Reason::ManualOff);
    if (cooling) {
      manual.active = false;
      return finish(false, Reason::Cooldown);
    }
    return finish(true, Reason::Manual);
  }

  // 3. Manual mode without a command: the pump rests.
  if (in.mode == Mode::Manual) return finish(false, Reason::Idle);

  // 4–6. Auto-mode interlocks.
  if (!in.soilValid || isnan(in.soilMoisture)) return finish(false, Reason::SensorFault);
  if (s.rainLockout && in.rain) return finish(false, Reason::Rain);
  if (cooling) return finish(false, Reason::Cooldown);

  // 7. Hysteresis thresholds.
  if (in.soilMoisture < s.moistureLow) return finish(true, Reason::Dry);
  if (in.soilMoisture > s.moistureHigh) return finish(false, Reason::Wet);
  return finish(in.pumpOn, Reason::Hold);
}

bool rawToMoisture(int raw, int dryRaw, int wetRaw, float& out) {
  if (raw < XG_SOIL_RAW_FAULT_LOW || raw > XG_SOIL_RAW_FAULT_HIGH) return false;
  const int span = wetRaw - dryRaw;
  if (span > -100 && span < 100) return false;
  float pct = (static_cast<float>(raw - dryRaw) / static_cast<float>(span)) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  out = roundf(pct * 10.0f) / 10.0f;
  return true;
}

int median(const int* values, int n) {
  if (n <= 0) return 0;
  int tmp[32];
  if (n > 32) n = 32;
  memcpy(tmp, values, sizeof(int) * n);
  for (int i = 1; i < n; i++) {  // insertion sort (n is tiny)
    int v = tmp[i];
    int j = i - 1;
    while (j >= 0 && tmp[j] > v) {
      tmp[j + 1] = tmp[j];
      j--;
    }
    tmp[j + 1] = v;
  }
  return n % 2 ? tmp[n / 2] : (tmp[n / 2 - 1] + tmp[n / 2]) / 2;
}

}  // namespace xg
