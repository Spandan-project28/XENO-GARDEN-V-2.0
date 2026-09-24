#pragma once
#include <Arduino.h>

#include "config.h"

namespace pump {

inline void write(bool on) {
#if RELAY_ACTIVE_LOW
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);
#else
  digitalWrite(PIN_RELAY, on ? HIGH : LOW);
#endif
}

/** Must be the very first thing at boot: the pump is OFF until automation says otherwise. */
inline void initOff() {
  write(false);  // set the latch level before enabling the output driver
  pinMode(PIN_RELAY, OUTPUT);
  write(false);
}

}  // namespace pump
