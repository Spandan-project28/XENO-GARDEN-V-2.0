#pragma once
// Sensor interpretation that doesn't depend on the exact module wired up. Pure; host-tested.
#include <stdint.h>

namespace xg {

/**
 * Rain sensor digital output. Modules differ: most pull DO low when wet, some drive it high, and
 * the sensitivity pot can be set anywhere. So the level seen while the board starts up (sensor
 * dry) is learned as "no rain", and rain is reported only while the pin holds the other level.
 * Changes need 3 agreeing reads in a row (debounce).
 */
class RainDetector {
 public:
  /** Feed one digital read (true = HIGH). Returns the debounced "raining" state. */
  bool update(bool level);
  bool raining() const { return raining_; }
  bool learned() const { return learned_; }

 private:
  static const uint8_t kLearnReads = 3;
  static const uint8_t kAgree = 3;
  bool learned_ = false;
  bool dryLevel_ = true;
  uint8_t seen_ = 0;
  uint8_t highs_ = 0;
  bool raining_ = false;
  uint8_t agree_ = 0;
};

/**
 * Widens an uncalibrated soil range to what the sensor really reads, so a sensor powered at 5 V
 * (reads ~3900 in air) doesn't sit at 0 % against defaults made for 3.3 V. A measured end is
 * never touched; values the fault check rejects are ignored. Returns true if anything changed.
 */
bool widenSoilRange(int raw, int& dryRaw, int& wetRaw, bool dryMeasured, bool wetMeasured);

}  // namespace xg
