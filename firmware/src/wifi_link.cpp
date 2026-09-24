#include "wifi_link.h"

#include <WiFi.h>

#include "config.h"
#include "storage.h"
#include "timebase.h"

namespace wifi_link {

enum class Phase { Idle, Scanning, Connecting, Connected, Backoff, Attempt };

static Phase phase = Phase::Idle;
static SavedNetwork networks[MAX_SAVED_NETWORKS];
static int networkCount = 0;
static int order[MAX_SAVED_NETWORKS];
static int orderCount = 0;
static int orderPos = 0;
static int64_t phaseStarted = 0;
static int64_t backoffMs = WIFI_BACKOFF_MIN_MS;
static volatile uint8_t lastDisconnectReason = 0;
static String currentSsid;
static bool networkChanged = false;

static String attemptSsid;
static String attemptPassword;
static AttemptResult attemptState = AttemptResult::Timeout;
static bool attemptRunning = false;
static bool appScanRequested = false;

static void onEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) lastDisconnectReason = info.wifi_sta_disconnected.reason;
}

static void reload() { networkCount = storage::loadNetworks(networks, MAX_SAVED_NETWORKS); }

static void enter(Phase p) {
  phase = p;
  phaseStarted = nowMs();
}

void begin() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.setSleep(true);
  WiFi.onEvent(onEvent);
  reload();
  enter(networkCount ? Phase::Scanning : Phase::Idle);
  if (networkCount) WiFi.scanNetworks(true);
}

bool connected() { return WiFi.status() == WL_CONNECTED; }
String ssid() { return connected() ? WiFi.SSID() : String(); }
int rssi() { return connected() ? WiFi.RSSI() : 0; }
String ip() { return connected() ? WiFi.localIP().toString() : String(); }
bool hasSavedNetworks() { return networkCount > 0; }

bool takeNetworkChanged() {
  const bool c = networkChanged;
  networkChanged = false;
  return c;
}

static void beginJoin(const String& s, const String& pw) {
  lastDisconnectReason = 0;
  WiFi.disconnect(false, false);
  if (pw.length()) WiFi.begin(s.c_str(), pw.c_str());
  else WiFi.begin(s.c_str());
}

/** Orders saved networks: visible ones by signal strength first, then the rest (hidden SSIDs). */
static void buildOrder(int found) {
  orderCount = 0;
  bool used[MAX_SAVED_NETWORKS] = {false};
  for (int pass = 0; pass < 2; pass++) {
    while (true) {
      int best = -1;
      int bestRssi = -1000;
      for (int i = 0; i < networkCount; i++) {
        if (used[i]) continue;
        int r = -1000;
        for (int j = 0; j < found; j++) {
          if (WiFi.SSID(j) == networks[i].ssid && WiFi.RSSI(j) > r) r = WiFi.RSSI(j);
        }
        if (pass == 0 && r == -1000) continue;
        if (r > bestRssi || best < 0) {
          best = i;
          bestRssi = r;
        }
      }
      if (best < 0) break;
      used[best] = true;
      order[orderCount++] = best;
    }
  }
  orderPos = 0;
}

static void onJoined(const String& s) {
  if (currentSsid.length() && currentSsid != s) networkChanged = true;
  currentSsid = s;
  backoffMs = WIFI_BACKOFF_MIN_MS;
  enter(Phase::Connected);
}

static AttemptResult classify() {
  switch (lastDisconnectReason) {
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_AUTH_EXPIRE:
    case WIFI_REASON_MIC_FAILURE:
      return AttemptResult::WrongPassword;
    case WIFI_REASON_NO_AP_FOUND:
      return AttemptResult::NotFound;
    default:
      return AttemptResult::Timeout;
  }
}

void startAttempt(const String& s, const String& pw) {
  attemptSsid = s;
  attemptPassword = pw;
  attemptRunning = true;
  attemptState = AttemptResult::Pending;
  WiFi.scanDelete();
  beginJoin(s, pw);
  enter(Phase::Attempt);
}

AttemptResult attemptResult() { return attemptState; }
bool attemptActive() { return attemptRunning; }

void startScan() {
  appScanRequested = true;
  if (phase == Phase::Scanning) return;  // background scan results will be reused
  WiFi.scanDelete();
  WiFi.scanNetworks(true);
}

int scanResultsReady() {
  const int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return -1;
  if (n == WIFI_SCAN_FAILED) return appScanRequested ? 0 : -2;
  return n;
}

void scanResult(int i, String& s, int& r, bool& secure) {
  s = WiFi.SSID(i);
  r = WiFi.RSSI(i);
  secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
}

void scanDone() {
  appScanRequested = false;
  if (phase != Phase::Scanning) WiFi.scanDelete();
}

void loop() {
  const int64_t now = nowMs();
  switch (phase) {
    case Phase::Idle:
      if (networkCount) {
        WiFi.scanNetworks(true);
        enter(Phase::Scanning);
      }
      break;

    case Phase::Scanning: {
      if (appScanRequested) break;  // let the app read the results first
      const int n = WiFi.scanComplete();
      if (n == WIFI_SCAN_RUNNING) {
        if (now - phaseStarted > 15000) {
          WiFi.scanDelete();
          buildOrder(0);
        } else {
          break;
        }
      } else {
        buildOrder(n > 0 ? n : 0);
        WiFi.scanDelete();
      }
      if (!orderCount) {
        enter(Phase::Backoff);
        break;
      }
      beginJoin(networks[order[0]].ssid, networks[order[0]].password);
      enter(Phase::Connecting);
      break;
    }

    case Phase::Connecting:
      if (connected()) {
        onJoined(networks[order[orderPos]].ssid);
        if (orderPos > 0) storage::rememberNetwork(networks[order[orderPos]].ssid, networks[order[orderPos]].password);
        reload();
      } else if (now - phaseStarted > WIFI_ATTEMPT_TIMEOUT_MS ||
                 (lastDisconnectReason && WiFi.status() == WL_CONNECT_FAILED)) {
        if (++orderPos < orderCount) {
          beginJoin(networks[order[orderPos]].ssid, networks[order[orderPos]].password);
          enter(Phase::Connecting);
        } else {
          WiFi.disconnect(false, false);
          enter(Phase::Backoff);
        }
      }
      break;

    case Phase::Connected:
      if (!connected()) {
        WiFi.scanNetworks(true);
        enter(Phase::Scanning);
      }
      break;

    case Phase::Backoff:
      if (now - phaseStarted >= backoffMs) {
        backoffMs = min<int64_t>(backoffMs * 2, WIFI_BACKOFF_MAX_MS);
        reload();
        WiFi.scanNetworks(true);
        enter(networkCount ? Phase::Scanning : Phase::Idle);
      }
      break;

    case Phase::Attempt:
      if (connected()) {
        storage::rememberNetwork(attemptSsid, attemptPassword);
        reload();
        attemptState = AttemptResult::Connected;
        attemptRunning = false;
        onJoined(attemptSsid);
      } else {
        const AttemptResult r = classify();
        const bool definite = r == AttemptResult::WrongPassword || r == AttemptResult::NotFound;
        if ((definite && now - phaseStarted > 3000) || now - phaseStarted > WIFI_ATTEMPT_TIMEOUT_MS + 5000) {
          attemptState = definite ? r : AttemptResult::Timeout;
          attemptRunning = false;
          WiFi.disconnect(false, false);
          // fall back to the saved networks
          reload();
          enter(Phase::Idle);  // Idle rescans the saved networks, if any
        }
      }
      break;
  }
}

}  // namespace wifi_link
