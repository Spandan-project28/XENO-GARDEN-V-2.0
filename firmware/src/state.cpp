#include "state.h"

DeviceState gState;
SemaphoreHandle_t gStateMutex = nullptr;

void stateInit() {
  gStateMutex = xSemaphoreCreateMutex();
  gState.settings = xg::defaultSettings();
  xg::DeviceSettings s;
  xg::Mode mode;
  uint32_t ver = 0;
  if (storage::loadSettings(s, mode, ver)) {
    gState.settings = s;
    gState.mode = mode;
    gState.appliedVersion = ver;
  }
  gState.calibration = storage::loadCalibration();
}
