// The control loop owns the pump. It runs in its own FreeRTOS task so that slow network calls
// (WiFi joins, TLS handshakes, MQTT reconnects) can never delay a safety cut-off.
#include "control.h"

#include "config.h"
#include "pump.h"
#include "sensors.h"
#include "state.h"
#include "timebase.h"

namespace control {

static TaskHandle_t task = nullptr;

static void tick() {
  const SensorReading r = sensors::read();  // outside the lock (takes a few ms)
  StateLock lock;
  DeviceState& s = gState;
  const int64_t now = nowMs();

  float moisture = NAN;
  const bool soilValid =
      xg::rawToMoisture(r.soilRaw, s.calibration.dryRaw, s.calibration.wetRaw, moisture);
  if (s.sensorsReady && soilValid != s.soilValid) s.sensorFaultEdge = soilValid ? -1 : 1;
  s.soilValid = soilValid;
  s.soil = moisture;
  s.soilRaw = r.soilRaw;
  s.tempValid = r.tempValid;
  s.temperature = r.temperature;
  s.humidityValid = r.humidityValid;
  s.humidity = r.humidity;
  s.rain = r.rain;
  s.sensorsReady = true;

  // Extra fail-safe: a manual command must not keep running if the cloud has been gone a long
  // time (the user can't see or stop it). Automation keeps working offline.
  if (s.manual.active && !s.cloudConnected && s.cloudLostSince &&
      now - s.cloudLostSince > static_cast<int64_t>(MANUAL_CLOUD_LOSS_CANCEL_MS)) {
    s.manual.active = false;
    s.reportedDirty = true;
  }

  xg::Input in;
  in.now = now;
  in.mode = s.mode;
  in.settings = xg::toAutomationSettings(s.settings);
  in.soilValid = soilValid;
  in.soilMoisture = moisture;
  in.rain = r.rain;
  in.pumpOn = s.pumpOn;
  in.pumpSince = s.pumpSince;
  in.cooling = s.cooling;
  in.cooldownUntil = s.cooldownUntil;
  in.manual = s.manual;

  const xg::Output out = xg::evaluate(in);

  if (out.pumpOn != s.pumpOn) {
    pump::write(out.pumpOn);
    s.pumpChanged = true;
  }
  if (out.reason != s.reason || out.manual.active != s.manual.active) s.reportedDirty = true;
  if (out.reason == xg::Reason::MaxRuntime && s.reason != xg::Reason::MaxRuntime) s.maxRuntimeEvent = true;

  s.pumpOn = out.pumpOn;
  s.pumpSince = out.pumpSince;
  s.reason = out.reason;
  s.cooling = out.cooling;
  s.cooldownUntil = out.cooldownUntil;
  s.manual = out.manual;
}

static void run(void*) {
  for (;;) {
    tick();
    // Sleep until the next tick, or until poked by a new desired state.
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(CONTROL_TICK_MS));
  }
}

void start() {
  {
    StateLock lock;
    gState.pumpSince = nowMs();
  }
  xTaskCreatePinnedToCore(run, "xg-control", 6144, nullptr, configMAX_PRIORITIES - 3, &task, 1);
}

void poke() {
  if (task) xTaskNotifyGive(task);
}

}  // namespace control
