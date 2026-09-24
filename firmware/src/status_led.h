#pragma once
#include <Arduino.h>

namespace status_led {

enum class Pattern {
  Off,
  Pairing,         // fast double blink
  ConnectingWifi,  // slow blink (1 Hz)
  ConnectingCloud, // quick blink (2 Hz)
  Online,          // short heartbeat every 3 s
  Fault,           // 4 rapid blinks every 2 s
  Identify,        // strobe
  Reset,           // solid on (factory reset imminent)
};

void begin();
void set(Pattern p);
/** Temporarily overrides the pattern (e.g. identify for 10 s). */
void flash(Pattern p, uint32_t forMs);
void loop();

}  // namespace status_led
