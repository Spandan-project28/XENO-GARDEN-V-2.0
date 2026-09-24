#include "status_led.h"

#include "config.h"
#include "timebase.h"

namespace status_led {

static Pattern base = Pattern::Off;
static Pattern overridePattern = Pattern::Off;
static int64_t overrideUntil = 0;

void begin() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
}

void set(Pattern p) { base = p; }

void flash(Pattern p, uint32_t forMs) {
  overridePattern = p;
  overrideUntil = nowMs() + forMs;
}

static bool levelFor(Pattern p, int64_t t) {
  switch (p) {
    case Pattern::Off:
      return false;
    case Pattern::Reset:
      return true;
    case Pattern::ConnectingWifi:
      return (t % 1000) < 500;
    case Pattern::ConnectingCloud:
      return (t % 500) < 250;
    case Pattern::Identify:
      return (t % 120) < 60;
    case Pattern::Online:
      return (t % 3000) < 60;
    case Pattern::Pairing: {
      const int64_t m = t % 1000;
      return m < 80 || (m >= 200 && m < 280);
    }
    case Pattern::Fault: {
      const int64_t m = t % 2000;
      return m < 800 && (m % 200) < 100;
    }
  }
  return false;
}

void loop() {
  const int64_t t = nowMs();
  const Pattern p = t < overrideUntil ? overridePattern : base;
  digitalWrite(PIN_LED, levelFor(p, t) ? HIGH : LOW);
}

}  // namespace status_led
