#include "provisioning.h"

#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <string>
#include <vector>

#include "config.h"
#include "mqtt_link.h"
#include "storage.h"
#include "timebase.h"
#include "wifi_link.h"
#include "xg_contract.h"
#include "xg_frames.h"
#include "xg_pairing.h"

namespace provisioning {

// BLE callbacks run on the NimBLE host task: they only queue work; loop() does it.
struct Inbox {
  SemaphoreHandle_t lock = nullptr;
  std::vector<std::string> wifiFrames;
  std::vector<std::string> cloudFrames;
  bool scanRequested = false;
};
static Inbox inbox;

static NimBLEServer* server = nullptr;
static NimBLECharacteristic* cInfo = nullptr;
static NimBLECharacteristic* cScan = nullptr;
static NimBLECharacteristic* cWifi = nullptr;
static NimBLECharacteristic* cCloud = nullptr;
static NimBLECharacteristic* cState = nullptr;

static bool active = false;            // advertising / accepting a phone
static int64_t setupUntil = -1;        // owner-opened setup window: -1 closed, 0 open-ended
static int64_t lingerUntil = 0;        // stay reachable briefly after "online"
static bool clientConnected = false;
static String hwId;
static xg::PairingPolicy policy(REJOIN_AFTER_MS);
static xg::PairMode infoMode = xg::PairMode::Off;  // what the `info` characteristic says

static xg::FrameAssembler wifiAsm;
static xg::FrameAssembler cloudAsm;

enum class Job { None, Joining, Cloud };
static Job job = Job::None;
static int64_t jobStarted = 0;
static bool scanning = false;

static void notifyState(const char* s, const char* reason = nullptr) {
  if (!cState) return;
  JsonDocument doc;
  doc["s"] = s;
  if (reason) doc["r"] = reason;
  const String ip = wifi_link::ip();
  if (ip.length()) doc["ip"] = ip;
  std::string out;
  serializeJson(doc, out);
  cState->setValue(out);
  if (clientConnected) cState->notify();
}

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*) override { clientConnected = true; }
  void onDisconnect(NimBLEServer*) override {
    clientConnected = false;
    if (active) NimBLEDevice::startAdvertising();
  }
};

class WriteCb : public NimBLECharacteristicCallbacks {
 public:
  explicit WriteCb(int which) : which_(which) {}
  void onWrite(NimBLECharacteristic* c) override {
    std::string v = c->getValue();
    xSemaphoreTake(inbox.lock, portMAX_DELAY);
    if (which_ == 0) inbox.scanRequested = true;
    else if (which_ == 1) inbox.wifiFrames.push_back(v);
    else inbox.cloudFrames.push_back(v);
    xSemaphoreGive(inbox.lock);
  }

 private:
  int which_;
};

void begin(const String& hardwareId, const String& bleName) {
  hwId = hardwareId;
  inbox.lock = xSemaphoreCreateMutex();
  NimBLEDevice::init(bleName.c_str());
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(185);
  // No Bluetooth pairing: setup must work every time on every phone. Required encryption meant
  // pairing, and pairing keys went stale whenever either side forgot them (reset, reflash, other
  // phone) — then every read failed. Protection instead: setup mode only opens on a new/reset
  // device or by the owner and closes again, and claiming needs the claim code (physical access).
  // See docs/SECURITY.md (app-level encryption of the WiFi password is the planned upgrade).
  NimBLEDevice::setSecurityAuth(false, false, false);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCb());
  NimBLEService* svc = server->createService(XG_BLE_SERVICE_UUID);

  cInfo = svc->createCharacteristic(XG_BLE_CHAR_INFO, NIMBLE_PROPERTY::READ);
  cScan = svc->createCharacteristic(XG_BLE_CHAR_WIFI_SCAN, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  cWifi = svc->createCharacteristic(XG_BLE_CHAR_WIFI_CREDS, NIMBLE_PROPERTY::WRITE);
  cCloud = svc->createCharacteristic(XG_BLE_CHAR_CLOUD_CREDS, NIMBLE_PROPERTY::WRITE);
  cState = svc->createCharacteristic(XG_BLE_CHAR_STATE, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  cScan->setCallbacks(new WriteCb(0));
  cWifi->setCallbacks(new WriteCb(1));
  cCloud->setCallbacks(new WriteCb(2));

  notifyState("idle");

  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(XG_BLE_SERVICE_UUID);
  adv->setScanResponse(true);
}

/** The `info` characteristic: the claim code is only readable in setup mode (ADR-018). */
static void writeInfo(xg::PairMode m) {
  JsonDocument info;
  info["proto"] = XG_BLE_PROTOCOL_VERSION;
  info["hwId"] = hwId;
  info["fw"] = XG_FW_VERSION;
  info["mode"] = m == xg::PairMode::Rejoin ? "rejoin" : "setup";
  // Assign a String (ArduinoJson copies it). A `.c_str()` of the temporary would leave the document
  // pointing at freed memory and the phone would read garbage bytes.
  const String code = m == xg::PairMode::Rejoin ? String() : storage::claimCode();
  info["claimCode"] = code;
  std::string out;
  serializeJson(info, out);
  cInfo->setValue(out);
  infoMode = m;
}

static void startAdvertising() {
  if (active) return;
  active = true;
  NimBLEDevice::startAdvertising();
  log_i("BLE setup on (%s)", xg::pairModeName(infoMode));
}

static void stopAdvertising() {
  if (!active) return;
  active = false;
  NimBLEDevice::stopAdvertising();
  if (server) {
    for (auto h : server->getPeerDevices()) server->disconnect(h);
  }
  log_i("BLE setup off");
}

void startPairing(uint32_t windowMs) {
  setupUntil = windowMs ? nowMs() + windowMs : 0;
  log_i("setup window opened (%u ms)", windowMs);
}

void stopPairing() {
  setupUntil = -1;
  lingerUntil = 0;
  stopAdvertising();
}

bool pairing() { return active; }

bool rejoining() { return active && infoMode == xg::PairMode::Rejoin; }

void forgetBonds() { NimBLEDevice::deleteAllBonds(); }

static void handleCloud(const std::string& json) {
  // Rejoin mode only accepts new WiFi: cloud credentials could re-home the device.
  if (infoMode == xg::PairMode::Rejoin) return notifyState("cloud_failed");
  JsonDocument doc;
  if (deserializeJson(doc, json)) return notifyState("cloud_failed");
  CloudConfig c;
  c.host = doc["h"] | "";
  c.port = doc["p"] | 0;
  c.tls = doc["t"] | false;
  c.username = doc["u"] | "";
  c.password = doc["pw"] | "";
  if (!c.valid() || c.username != hwId) return notifyState("cloud_failed");
  mqtt_link::setCloud(c);
}

static void handleWifi(const std::string& json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return notifyState("wifi_failed", "unknown");
  const String ssid = doc["ssid"] | "";
  const String pw = doc["pw"] | "";
  if (!ssid.length()) return notifyState("wifi_failed", "ssid_not_found");
  wifi_link::startAttempt(ssid, pw);
  job = Job::Joining;
  jobStarted = nowMs();
  notifyState("connecting_wifi");
}

static void runScan() {
  if (!scanning) {
    wifi_link::startScan();
    scanning = true;
    return;
  }
  const int n = wifi_link::scanResultsReady();
  if (n == -1) return;  // still running
  scanning = false;
  int sent = 0;
  if (n > 0) {
    for (int i = 0; i < n && sent < 20; i++) {
      String ssid;
      int rssi;
      bool secure;
      wifi_link::scanResult(i, ssid, rssi, secure);
      if (!ssid.length()) continue;  // hidden networks don't broadcast a name
      JsonDocument f;
      f["t"] = "net";
      f["ssid"] = ssid;
      f["rssi"] = rssi;
      f["sec"] = secure;
      std::string out;
      serializeJson(f, out);
      cScan->setValue(out);
      cScan->notify();
      sent++;
      delay(15);  // let the notification go out
    }
  }
  wifi_link::scanDone();
  cScan->setValue(std::string("{\"t\":\"end\",\"n\":") + std::to_string(sent) + "}");
  cScan->notify();
}

void loop() {
  // Drain the inbox (frames written by the phone).
  std::vector<std::string> wifiFrames, cloudFrames;
  bool scanReq = false;
  xSemaphoreTake(inbox.lock, portMAX_DELAY);
  wifiFrames.swap(inbox.wifiFrames);
  cloudFrames.swap(inbox.cloudFrames);
  scanReq = inbox.scanRequested;
  inbox.scanRequested = false;
  xSemaphoreGive(inbox.lock);

  std::string msg;
  for (auto& f : cloudFrames) {
    if (cloudAsm.push(f, msg) == xg::FrameAssembler::Result::Complete) handleCloud(msg);
  }
  for (auto& f : wifiFrames) {
    if (wifiAsm.push(f, msg) == xg::FrameAssembler::Result::Complete) handleWifi(msg);
  }
  if (scanReq || scanning) runScan();

  const int64_t now = nowMs();
  if (job == Job::Joining && !wifi_link::attemptActive()) {
    switch (wifi_link::attemptResult()) {
      case wifi_link::AttemptResult::Connected:
        job = Job::Cloud;
        jobStarted = now;
        mqtt_link::kick();
        notifyState("connecting_cloud");
        break;
      case wifi_link::AttemptResult::WrongPassword:
        job = Job::None;
        notifyState("wifi_failed", "wrong_password");
        break;
      case wifi_link::AttemptResult::NotFound:
        job = Job::None;
        notifyState("wifi_failed", "ssid_not_found");
        break;
      default:
        job = Job::None;
        notifyState("wifi_failed", "timeout");
        break;
    }
  } else if (job == Job::Cloud) {
    if (mqtt_link::connected()) {
      job = Job::None;
      notifyState("online");
      // Give the app a moment to read the final state, then close setup.
      lingerUntil = now + 15000;
      if (setupUntil == 0 || setupUntil > lingerUntil) setupUntil = lingerUntil;
    } else if (now - jobStarted > 25000) {
      job = Job::None;
      if (mqtt_link::lastFailureWasDns()) notifyState("wifi_failed", "no_internet");
      else notifyState("cloud_failed");
    }
  }

  // Decide the mode: setup (new / owner asked), rejoin (lost WiFi for a while), or off.
  const bool configured = wifi_link::hasSavedNetworks() && mqtt_link::hasCloud();
  const bool setupWindow = setupUntil == 0 || (setupUntil > 0 && now < setupUntil);
  if (setupUntil > 0 && now >= setupUntil) setupUntil = -1;
  const xg::PairMode mode = policy.update(configured, setupWindow, wifi_link::connected(), mqtt_link::connected(), now);

  const bool busy = clientConnected || job != Job::None || now < lingerUntil;
  if (mode != xg::PairMode::Off) {
    // Never switch modes under a connected phone: it read `info` already.
    if (mode != infoMode && !busy) writeInfo(mode);
    if (infoMode == xg::PairMode::Off) writeInfo(mode);
    startAdvertising();
  } else if (active && !busy) {
    stopAdvertising();
    infoMode = xg::PairMode::Off;
  }
}

}  // namespace provisioning
