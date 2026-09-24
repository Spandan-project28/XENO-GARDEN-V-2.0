#pragma once
#include <Arduino.h>

struct SensorReading {
  int soilRaw;        // median ADC value, -1 if unavailable
  bool tempValid;
  float temperature;  // °C
  bool humidityValid;
  float humidity;     // %
  bool rain;          // debounced
};

namespace sensors {
void begin();
/** Reads all sensors (DHT is rate-limited internally and cached between reads). */
SensorReading read();
/** Median raw soil value right now (for calibration). */
int soilRawNow();
}  // namespace sensors
