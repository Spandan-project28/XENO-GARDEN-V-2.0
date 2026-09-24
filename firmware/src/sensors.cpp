#include "sensors.h"

#include <DHT.h>

#include "config.h"
#include "timebase.h"
#include "xg_automation.h"

namespace sensors {

static DHT dht(PIN_DHT, DHT_TYPE);
static int64_t lastDhtAt = -DHT_MIN_INTERVAL_MS;
static float lastTemp = NAN;
static float lastHum = NAN;
static bool rainStable = false;
static uint8_t rainAgree = 0;

void begin() {
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);
  pinMode(PIN_RAIN, INPUT_PULLUP);
  dht.begin();
}

int soilRawNow() {
  int samples[SOIL_SAMPLES];
  for (int i = 0; i < SOIL_SAMPLES; i++) {
    samples[i] = analogRead(PIN_SOIL);
    delayMicroseconds(300);
  }
  return xg::median(samples, SOIL_SAMPLES);
}

SensorReading read() {
  SensorReading r;
  r.soilRaw = soilRawNow();

  const int64_t now = nowMs();
  if (now - lastDhtAt >= DHT_MIN_INTERVAL_MS) {
    lastDhtAt = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    lastTemp = isnan(t) ? NAN : t;
    lastHum = isnan(h) ? NAN : h;
  }
  r.tempValid = !isnan(lastTemp);
  r.temperature = lastTemp;
  r.humidityValid = !isnan(lastHum);
  r.humidity = lastHum;

  // Rain: require 3 consecutive identical readings before changing state (debounce).
  const bool raw = digitalRead(PIN_RAIN) == LOW;
  if (raw != rainStable) {
    if (++rainAgree >= 3) {
      rainStable = raw;
      rainAgree = 0;
    }
  } else {
    rainAgree = 0;
  }
  r.rain = rainStable;
  return r;
}

}  // namespace sensors
