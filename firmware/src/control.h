#pragma once
#include <Arduino.h>

namespace control {
/** Starts the control task (sensors → automation → pump) at high priority on core 1. */
void start();
/** Wakes the control task immediately (e.g. after a new desired state). */
void poke();
}  // namespace control
