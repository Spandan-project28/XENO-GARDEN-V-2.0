#pragma once
// Bluetooth LE provisioning (plan §7.4, protocol ADR-013). The app reads the device identity,
// hands over cloud + WiFi credentials, and watches live progress — no IP addresses involved.
#include <Arduino.h>

namespace provisioning {

void begin(const String& hardwareId, const String& bleName);
void loop();

/** Opens pairing mode for `windowMs` (0 = until the device is configured and online). */
void startPairing(uint32_t windowMs);
void stopPairing();
bool pairing();
/** Removes stored BLE bonds (factory reset). */
void forgetBonds();

}  // namespace provisioning
