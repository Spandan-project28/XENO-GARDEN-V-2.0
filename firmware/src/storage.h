#pragma once
// Persistent device configuration in NVS flash (survives reboots and power cuts).
#include <Arduino.h>

#include "config.h"
#include "xg_shadow.h"

struct SavedNetwork {
  String ssid;
  String password;
};

struct CloudConfig {
  String host;
  uint16_t port = 0;
  bool tls = false;
  String username;
  String password;
  bool valid() const { return host.length() && port && username.length() && password.length(); }
};

struct Calibration {
  int dryRaw = SOIL_DEFAULT_DRY_RAW;
  int wetRaw = SOIL_DEFAULT_WET_RAW;
  bool dryMeasured = false;
  bool wetMeasured = false;
  bool calibrated() const { return dryMeasured && wetMeasured; }
};

namespace storage {

void begin();

/** Networks, most recently successful first. */
int loadNetworks(SavedNetwork* out, int max);
/** Moves (or inserts) a network to the top of the list. */
void rememberNetwork(const String& ssid, const String& password);

CloudConfig loadCloud();
void saveCloud(const CloudConfig& c);

bool loadSettings(xg::DeviceSettings& s, xg::Mode& mode, uint32_t& appliedVersion);
void saveSettings(const xg::DeviceSettings& s, xg::Mode mode, uint32_t appliedVersion);

Calibration loadCalibration();
void saveCalibration(const Calibration& c);

/** Generated once at first boot; survives factory reset (proves physical possession). */
String claimCode();

/** Wipes WiFi, cloud and settings; keeps claim code and calibration. */
void factoryReset();

}  // namespace storage
