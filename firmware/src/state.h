#pragma once
// State shared between the control task (sensors + automation + pump safety) and the network
// loop (WiFi, MQTT, BLE). Always access under StateLock.
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "storage.h"
#include "xg_automation.h"
#include "xg_shadow.h"

struct DeviceState {
  // Configuration (from desired / NVS)
  xg::DeviceSettings settings;
  xg::Mode mode = xg::Mode::Auto;
  uint32_t appliedVersion = 0;
  xg::ManualCommand manual{};
  Calibration calibration;

  // Actuator + automation
  bool pumpOn = false;
  int64_t pumpSince = 0;
  xg::Reason reason = xg::Reason::Idle;
  bool cooling = false;
  int64_t cooldownUntil = 0;

  // Latest sensor snapshot
  bool soilValid = false;
  float soil = NAN;
  int soilRaw = -1;
  bool tempValid = false;
  float temperature = NAN;
  bool humidityValid = false;
  float humidity = NAN;
  bool rain = false;
  bool sensorsReady = false;

  // Connectivity (written by the network side)
  bool cloudConnected = false;
  int64_t cloudLostSince = 0;

  // Edge flags for the network side (set by control task, cleared when published)
  bool pumpChanged = false;
  bool reportedDirty = true;
  bool maxRuntimeEvent = false;
  int8_t sensorFaultEdge = 0;  // +1 fault began, -1 recovered
};

extern DeviceState gState;
extern SemaphoreHandle_t gStateMutex;

struct StateLock {
  StateLock() { xSemaphoreTake(gStateMutex, portMAX_DELAY); }
  ~StateLock() { xSemaphoreGive(gStateMutex); }
  StateLock(const StateLock&) = delete;
  StateLock& operator=(const StateLock&) = delete;
};

void stateInit();
