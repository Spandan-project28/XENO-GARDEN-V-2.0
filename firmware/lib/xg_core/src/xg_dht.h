#pragma once
// Decoding of DHT11 / DHT22 frames (5 bytes: humidity, temperature, checksum). Pure; host-tested.
// The bit timing lives in src/sensors.cpp, with hard microsecond timeouts so a missing or
// broken sensor can never stall the CPU (the Adafruit library could trip the interrupt watchdog).
#include <stdint.h>

namespace xg {

/** Returns false for a bad checksum, an all-zero frame (no sensor) or out-of-range values. */
bool decodeDht(const uint8_t data[5], bool dht22, float& tempC, float& humidity);

}  // namespace xg
