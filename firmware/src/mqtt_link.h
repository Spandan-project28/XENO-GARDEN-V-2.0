#pragma once
// Cloud link over MQTT (plan §7.1): status/LWT, telemetry, reported, events, desired, commands.
#include <Arduino.h>

#include "storage.h"

namespace mqtt_link {

void begin(const String& hardwareId);
void loop();
bool connected();

/** New broker credentials (from BLE) — reconnect with them right away. */
void setCloud(const CloudConfig& c);
bool hasCloud();
/** Reset backoff and try to connect immediately (after provisioning). */
void kick();
/** Last connect failure was a DNS failure (network without internet). */
bool lastFailureWasDns();

enum class LedHint { None, Identify };
LedHint takeLedHint();
bool takePairingRequest();

}  // namespace mqtt_link
