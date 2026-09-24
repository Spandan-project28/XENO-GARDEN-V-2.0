#pragma once
// Non-blocking WiFi manager: remembers up to MAX_SAVED_NETWORKS networks, joins the strongest
// one in range, roams/reconnects with backoff, and runs "provisioning attempts" for the app.
#include <Arduino.h>

namespace wifi_link {

enum class AttemptResult { Pending, Connected, WrongPassword, NotFound, Timeout };

void begin();
void loop();

bool connected();
String ssid();
int rssi();
String ip();
bool hasSavedNetworks();

/** Tries exactly this network now (from BLE). Saved on success. */
void startAttempt(const String& ssid, const String& password);
/** Result of the current/last attempt (Pending while running). */
AttemptResult attemptResult();
bool attemptActive();

/** Async scan for the app. Returns true when results are ready (then call scanResults). */
void startScan();
int scanResultsReady();  // -1 running, -2 not started, else count
void scanResult(int i, String& ssid, int& rssi, bool& secure);
void scanDone();

/** Set when the device moved to a different network (for the wifi_changed event). */
bool takeNetworkChanged();

}  // namespace wifi_link
