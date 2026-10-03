#include "xg_sensors.h"

#include "xg_contract.h"

namespace xg {

bool RainDetector::update(bool level) {
  if (!learned_) {
    // Majority of the first reads after power-on = the dry level.
    seen_++;
    if (level) highs_++;
    if (seen_ >= kLearnReads) {
      dryLevel_ = highs_ * 2 > seen_;
      learned_ = true;
    }
    return raining_;  // false until learned
  }
  const bool wet = level != dryLevel_;
  if (wet != raining_) {
    if (++agree_ >= kAgree) {
      raining_ = wet;
      agree_ = 0;
    }
  } else {
    agree_ = 0;
  }
  return raining_;
}

bool widenSoilRange(int raw, int& dryRaw, int& wetRaw, bool dryMeasured, bool wetMeasured) {
  if (raw < XG_SOIL_RAW_FAULT_LOW || raw > XG_SOIL_RAW_FAULT_HIGH) return false;
  // Capacitive (and resistive) sensors read higher when drier: dry end is the high one.
  if (dryRaw >= wetRaw) {
    if (!dryMeasured && raw > dryRaw) return (dryRaw = raw), true;
    if (!wetMeasured && raw < wetRaw) return (wetRaw = raw), true;
  } else {
    if (!dryMeasured && raw < dryRaw) return (dryRaw = raw), true;
    if (!wetMeasured && raw > wetRaw) return (wetRaw = raw), true;
  }
  return false;
}

}  // namespace xg
