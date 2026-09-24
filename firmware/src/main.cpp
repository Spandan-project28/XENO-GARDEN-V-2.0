// Xeno Garden v2 firmware — orchestration only. See implementation_plan.md §7 / docs/HARDWARE.md.
//
//   core 1, high priority:  control task  (sensors → automation → pump, 1 Hz, never blocked)
//   Arduino loop():         WiFi manager, MQTT link, BLE provisioning, LED, button
#include <Arduino.h>

#include "config.h"
#include "control.h"
#include "identity.h"
#include "mqtt_link.h"
#include "provisioning.h"
#include "pump.h"
#include "sensors.h"
#include "state.h"
#include "status_led.h"
#include "storage.h"
#include "timebase.h"
#include "wifi_link.h"

static String hwId;
static int64_t buttonDownAt = -1;
static bool pairingSignalled = false;

static void handleButton() {
  const bool down = digitalRead(PIN_BUTTON) == LOW;
  const int64_t now = nowMs();
  if (down && buttonDownAt < 0) {
    buttonDownAt = now;
    pairingSignalled = false;
  }
  if (down && buttonDownAt >= 0) {
    const int64_t held = now - buttonDownAt;
    if (held >= BUTTON_FACTORY_RESET_HOLD_MS) {
      status_led::set(status_led::Pattern::Reset);
      status_led::loop();
      log_w("factory reset");
      provisioning::forgetBonds();
      storage::factoryReset();
      delay(500);
      ESP.restart();
    } else if (held >= BUTTON_PAIRING_HOLD_MS && !pairingSignalled) {
      pairingSignalled = true;
      status_led::flash(status_led::Pattern::Pairing, 1500);  // feedback: release now for pairing
    }
  }
  if (!down && buttonDownAt >= 0) {
    if (now - buttonDownAt >= BUTTON_PAIRING_HOLD_MS) provisioning::startPairing(PAIRING_WINDOW_MS);
    buttonDownAt = -1;
  }
}

static void updateLed() {
  bool fault;
  {
    StateLock lock;
    fault = gState.sensorsReady && !gState.soilValid;
  }
  using P = status_led::Pattern;
  if (provisioning::pairing()) status_led::set(P::Pairing);
  else if (!wifi_link::connected()) status_led::set(wifi_link::hasSavedNetworks() ? P::ConnectingWifi : P::Pairing);
  else if (!mqtt_link::connected()) status_led::set(P::ConnectingCloud);
  else status_led::set(fault ? P::Fault : P::Online);
}

void setup() {
  pump::initOff();  // first: the pump must never twitch on at boot
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  status_led::begin();

  storage::begin();
  stateInit();
  sensors::begin();
  control::start();

  hwId = hardwareId();
  log_i("Xeno Garden %s — %s (claim code %s)", XG_FW_VERSION, hwId.c_str(), storage::claimCode().c_str());

  wifi_link::begin();
  startTimeSync();
  mqtt_link::begin(hwId);
  provisioning::begin(hwId, bleName());

  // Unconfigured devices open pairing until setup completes.
  if (!wifi_link::hasSavedNetworks() || !mqtt_link::hasCloud()) provisioning::startPairing(0);
}

void loop() {
  wifi_link::loop();
  mqtt_link::loop();
  provisioning::loop();
  handleButton();

  if (mqtt_link::takePairingRequest()) provisioning::startPairing(PAIRING_WINDOW_MS);
  if (mqtt_link::takeLedHint() == mqtt_link::LedHint::Identify) {
    status_led::flash(status_led::Pattern::Identify, 10000);
  }
  updateLed();
  status_led::loop();
  delay(10);
}
