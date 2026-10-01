#pragma once
#include <Arduino.h>
#include <esp_mac.h>

#include "xg_contract.h"

/** "xg-" + the 12-hex-digit factory MAC (lowercase). Stable for the life of the chip. */
inline String hardwareId() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char buf[16];
  snprintf(buf, sizeof(buf), "xg-%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

/** BLE advertised name: "Xeno-" + last 4 hex digits (uppercase), e.g. "Xeno-AB12". */
inline String bleName() {
  String id = hardwareId();
  String tail = id.substring(id.length() - 4);
  tail.toUpperCase();
  return String(XG_BLE_NAME_PREFIX) + tail;
}
