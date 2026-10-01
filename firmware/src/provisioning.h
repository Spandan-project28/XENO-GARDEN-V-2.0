#pragma once
// Bluetooth LE provisioning (plan §7.4, protocol ADR-013). The app reads the device identity,
// hands over cloud + WiFi credentials, and watches live progress — no IP addresses involved.
#include <Arduino.h>

namespace provisioning {

void begin(const String& hardwareId, const String& bleName);
void loop();

/**
 * Opens setup mode (claim code readable) for `windowMs` (0 = until configured and online).
 * Unconfigured devices are always in setup mode; devices that lost their WiFi for a while switch
 * to rejoin mode by themselves (xg_pairing.h).
 */
void startPairing(uint32_t windowMs);
void stopPairing();
/** Advertising for the app (setup or rejoin). */
bool pairing();
/** Advertising in rejoin mode: waiting for new WiFi. */
bool rejoining();
/** Removes stored BLE bonds (factory reset). */
void forgetBonds();

}  // namespace provisioning
