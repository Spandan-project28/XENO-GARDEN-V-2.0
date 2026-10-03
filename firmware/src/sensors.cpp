#include "sensors.h"

#include <driver/gpio.h>
#include <esp_timer.h>

#include "config.h"
#include "timebase.h"
#include "xg_automation.h"
#include "xg_dht.h"
#include "xg_sensors.h"

namespace sensors {

static portMUX_TYPE dhtMux = portMUX_INITIALIZER_UNLOCKED;
static int64_t lastDhtAt = -DHT_MIN_INTERVAL_MS;
static float lastTemp = NAN;
static float lastHum = NAN;
static xg::RainDetector rain;

void begin() {
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);
  pinMode(PIN_RAIN, INPUT_PULLUP);
  pinMode(PIN_DHT, INPUT_PULLUP);
}

/** Waits until the DHT line reads `level`; false after `timeoutUs`. Returns the wait in `us`. */
static inline bool waitLevel(int level, int64_t timeoutUs, int64_t& us) {
  const int64_t start = esp_timer_get_time();
  while (gpio_get_level(static_cast<gpio_num_t>(PIN_DHT)) != level) {
    if (esp_timer_get_time() - start > timeoutUs) return false;
  }
  us = esp_timer_get_time() - start;
  return true;
}

/**
 * Reads a DHT11/DHT22. Interrupts are only held off for the ~5 ms bit train, and every wait has a
 * 200 µs cap, so a missing, unplugged or broken sensor costs at most ~17 ms and never trips the
 * interrupt watchdog (the Adafruit library could stall long enough to reboot the board).
 */
static bool readDht(float& tempC, float& humidity) {
  uint8_t data[5] = {0, 0, 0, 0, 0};
  pinMode(PIN_DHT, OUTPUT);
  digitalWrite(PIN_DHT, LOW);
  delay(DHT_TYPE == 22 ? 2 : 20);  // start signal (interrupts still on)
  pinMode(PIN_DHT, INPUT_PULLUP);

  bool ok = true;
  int64_t us = 0;
  portENTER_CRITICAL(&dhtMux);
  // Response: line goes low ~80 µs, high ~80 µs, then low = first bit starts.
  ok = waitLevel(0, 200, us) && waitLevel(1, 200, us) && waitLevel(0, 200, us);
  for (int i = 0; ok && i < 40; i++) {
    int64_t highUs = 0;
    ok = waitLevel(1, 200, us) && waitLevel(0, 200, highUs);  // ~50 µs low, then 26 µs (0) / 70 µs (1) high
    data[i / 8] = static_cast<uint8_t>((data[i / 8] << 1) | (highUs > 45 ? 1 : 0));
  }
  portEXIT_CRITICAL(&dhtMux);
  return ok && xg::decodeDht(data, DHT_TYPE == 22, tempC, humidity);
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
    float t = NAN, h = NAN;
    if (readDht(t, h)) {
      lastTemp = t;
      lastHum = h;
    } else {
      lastTemp = NAN;  // reported as a sensor fault, never a crash
      lastHum = NAN;
    }
  }
  r.tempValid = !isnan(lastTemp);
  r.temperature = lastTemp;
  r.humidityValid = !isnan(lastHum);
  r.humidity = lastHum;

  // Rain: the level seen at power-on is "dry", whatever the module's polarity (see xg_sensors.h).
  const int rainLevel = digitalRead(PIN_RAIN);
  r.rain = rain.update(rainLevel == HIGH);

  // Wiring check over USB serial: raw levels every 10 s.
  static int64_t lastDiag = 0;
  if (now - lastDiag >= 10000) {
    lastDiag = now;
    log_i("sensors: soil raw=%d (GPIO%d) rain pin=%d -> %s, temp=%.1f hum=%.1f", r.soilRaw, PIN_SOIL, rainLevel,
          r.rain ? "rain" : "dry", lastTemp, lastHum);
  }
  return r;
}

}  // namespace sensors
