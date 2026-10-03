#include "mqtt_link.h"

#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "control.h"
#include "ota.h"
#include "provisioning.h"
#include "generated_config.h"
#include "sensors.h"
#include "state.h"
#include "timebase.h"
#include "wifi_link.h"
#include "xg_contract.h"

namespace mqtt_link {

static WiFiClient plainClient;
static WiFiClientSecure tlsClient;
static PubSubClient client;
static CloudConfig cloud;
static String hwId;
static String tTelemetry, tReported, tDesired, tCmd, tAck, tStatus, tEvent;
static int64_t nextAttemptAt = 0;
static int64_t backoffMs = MQTT_BACKOFF_MIN_MS;
static int64_t lastTelemetryAt = -1000000;
static int64_t lastReportedAt = -1000000;
static bool bootEventSent = false;
static bool dnsFailure = false;
static LedHint ledHint = LedHint::None;
static bool pairingRequested = false;
static bool rebootPending = false;
static int64_t rebootAt = 0;

struct TelemetrySnapshot {
  int64_t ts;
  bool soilValid;
  float soil;
  int soilRaw;
  bool tempValid;
  float temp;
  bool humValid;
  float hum;
  bool rain;
  bool pump;
};
static TelemetrySnapshot buffer[TELEMETRY_BUFFER];
static int bufHead = 0;
static int bufCount = 0;

static String topic(const char* leaf) { return String(XG_MQTT_ROOT) + "/" + hwId + "/" + leaf; }

bool connected() { return client.connected(); }
bool hasCloud() { return cloud.valid(); }
bool lastFailureWasDns() { return dnsFailure; }
void kick() {
  backoffMs = MQTT_BACKOFF_MIN_MS;
  nextAttemptAt = 0;
}

LedHint takeLedHint() {
  LedHint h = ledHint;
  ledHint = LedHint::None;
  return h;
}

bool takePairingRequest() {
  bool p = pairingRequested;
  pairingRequested = false;
  return p;
}

void setCloud(const CloudConfig& c) {
  cloud = c;
  storage::saveCloud(c);
  if (client.connected()) client.disconnect();
  kick();
}

// ── publishing helpers ───────────────────────────────────────────────────────
static bool publishJson(const String& t, JsonDocument& doc, bool retain = false) {
  String out;
  serializeJson(doc, out);
  return client.publish(t.c_str(), reinterpret_cast<const uint8_t*>(out.c_str()), out.length(), retain);
}

static void publishEvent(const char* type, JsonDocument* data = nullptr) {
  JsonDocument doc;
  doc["type"] = type;
  const int64_t ts = epochMs();
  if (ts) doc["ts"] = ts;
  if (data) doc["data"] = data->as<JsonObject>();
  else doc["data"].to<JsonObject>();
  publishJson(tEvent, doc);
}

static TelemetrySnapshot snapshot() {
  StateLock lock;
  const DeviceState& s = gState;
  return {epochMs(), s.soilValid, s.soil, s.soilRaw, s.tempValid, s.temperature, s.humidityValid, s.humidity, s.rain, s.pumpOn};
}

static bool publishTelemetry(const TelemetrySnapshot& t) {
  JsonDocument doc;
  if (t.ts) doc["ts"] = t.ts;
  if (t.soilValid) doc["soilMoisture"] = t.soil;
  else doc["soilMoisture"] = nullptr;
  if (t.soilRaw >= 0) doc["soilRaw"] = t.soilRaw;  // also when out of range: shows the wiring problem
  else doc["soilRaw"] = nullptr;
  if (t.tempValid) doc["temperature"] = roundf(t.temp * 10) / 10;
  else doc["temperature"] = nullptr;
  if (t.humValid) doc["humidity"] = roundf(t.hum * 10) / 10;
  else doc["humidity"] = nullptr;
  doc["rain"] = t.rain;
  doc["pump"] = t.pump;
  return publishJson(tTelemetry, doc);
}

static void bufferTelemetry(const TelemetrySnapshot& t) {
  buffer[(bufHead + bufCount) % TELEMETRY_BUFFER] = t;
  if (bufCount < TELEMETRY_BUFFER) bufCount++;
  else bufHead = (bufHead + 1) % TELEMETRY_BUFFER;
}

static void flushBuffer() {
  while (bufCount && client.connected()) {
    if (!publishTelemetry(buffer[bufHead])) break;
    bufHead = (bufHead + 1) % TELEMETRY_BUFFER;
    bufCount--;
    client.loop();
  }
}

static void publishReported() {
  JsonDocument doc;
  {
    StateLock lock;
    const DeviceState& s = gState;
    const int64_t now = nowMs();
    doc["appliedVersion"] = s.appliedVersion;
    doc["mode"] = s.mode == xg::Mode::Manual ? "manual" : "auto";
    doc["pump"] = s.pumpOn;
    doc["pumpReason"] = xg::reasonName(s.reason);
    if (s.manual.active) {
      doc["manualCmdId"] = s.manual.cmdId;
      doc["manualRemainingSec"] = static_cast<int32_t>((s.manual.expiresAt - now + 999) / 1000);
    } else {
      doc["manualCmdId"] = nullptr;
      doc["manualRemainingSec"] = nullptr;
    }
    if (s.cooling) doc["cooldownRemainingSec"] = static_cast<int32_t>((s.cooldownUntil - now + 999) / 1000);
    else doc["cooldownRemainingSec"] = nullptr;
    doc["soilCalibrated"] = s.calibration.calibrated();
    gState.reportedDirty = false;
  }
  doc["fwVersion"] = XG_FW_VERSION;
  doc["rssi"] = wifi_link::rssi();
  doc["ssid"] = wifi_link::ssid();
  doc["ip"] = wifi_link::ip();
  doc["uptimeSec"] = static_cast<uint32_t>(nowMs() / 1000);
  doc["heapFree"] = ESP.getFreeHeap();
  publishJson(tReported, doc, true);
  lastReportedAt = nowMs();
}

// ── inbound ──────────────────────────────────────────────────────────────────
static void applyDesired(const uint8_t* payload, unsigned int len) {
  if (!len) return;  // cleared retained message (device unclaimed)
  xg::Desired d;
  std::string err;
  if (!xg::parseDesired(reinterpret_cast<const char*>(payload), len, d, err)) {
    log_w("desired rejected: %s", err.c_str());
    return;
  }
  bool persist = false;
  {
    StateLock lock;
    DeviceState& s = gState;
    if (d.version <= s.appliedVersion) return;
    s.mode = d.mode;
    s.settings = d.settings;
    if (!d.manual.present) {
      s.manual.active = false;
    } else if (!s.manual.active || strcmp(s.manual.cmdId, d.manual.cmdId) != 0) {
      s.manual = xg::manualToLocal(d.manual, nowMs(), epochMs());
    }
    s.appliedVersion = d.version;
    s.reportedDirty = true;
    persist = true;
  }
  if (persist) {
    xg::DeviceSettings settings;
    xg::Mode mode;
    uint32_t ver;
    {
      StateLock lock;
      settings = gState.settings;
      mode = gState.mode;
      ver = gState.appliedVersion;
    }
    storage::saveSettings(settings, mode, ver);
  }
  control::poke();
}

static void ack(const char* cmdId, bool ok, const char* error = nullptr) {
  JsonDocument doc;
  doc["cmdId"] = cmdId;
  doc["ok"] = ok;
  if (error) doc["error"] = error;
  publishJson(tAck, doc);
}

static void handleCommand(const uint8_t* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  const char* cmdId = doc["cmdId"] | "";
  const char* type = doc["type"] | "";
  if (strlen(cmdId) < 4) return;

  if (!strcmp(type, "identify")) {
    ledHint = LedHint::Identify;
    ack(cmdId, true);
  } else if (!strcmp(type, "reboot")) {
    ack(cmdId, true);
    rebootPending = true;
    rebootAt = nowMs() + 800;
  } else if (!strcmp(type, "pairing")) {
    pairingRequested = true;
    ack(cmdId, true);
  } else if (!strcmp(type, "calibrate_dry") || !strcmp(type, "calibrate_wet")) {
    const int raw = sensors::soilRawNow();
    if (raw < XG_SOIL_RAW_FAULT_LOW || raw > XG_SOIL_RAW_FAULT_HIGH) {
      ack(cmdId, false, "sensor not connected");
      return;
    }
    Calibration cal;
    {
      StateLock lock;
      Calibration& c = gState.calibration;
      if (!strcmp(type, "calibrate_dry")) {
        c.dryRaw = raw;
        c.dryMeasured = true;
      } else {
        c.wetRaw = raw;
        c.wetMeasured = true;
      }
      gState.reportedDirty = true;
      cal = c;
    }
    storage::saveCalibration(cal);
    ack(cmdId, true);
    JsonDocument data;
    data["step"] = strcmp(type, "calibrate_dry") ? "wet" : "dry";
    data["raw"] = raw;
    publishEvent("calibrated", &data);
  } else if (!strcmp(type, "factory_reset")) {
    ack(cmdId, true);
    provisioning::forgetBonds();
    storage::factoryReset();
    rebootPending = true;
    rebootAt = nowMs() + 800;
  } else if (!strcmp(type, "ota")) {
    String error;
    const String url = doc["url"] | "";
    const String sha = doc["sha256"] | "";
    const String version = doc["version"] | "";
    // The ack is sent when the update finishes (see loop), or now if the request is invalid.
    if (!ota::schedule(cmdId, url, sha, version, error)) ack(cmdId, false, error.c_str());
  } else {
    ack(cmdId, false, "unknown command");
  }
}

static void onMessage(char* t, uint8_t* payload, unsigned int len) {
  if (tDesired == t) applyDesired(payload, len);
  else if (tCmd == t) handleCommand(payload, len);
}

// ── connection management ────────────────────────────────────────────────────
void begin(const String& id) {
  hwId = id;
  tTelemetry = topic("telemetry");
  tReported = topic("reported");
  tDesired = topic("desired");
  tCmd = topic("cmd");
  tAck = topic("cmd/ack");
  tStatus = topic("status");
  tEvent = topic("event");
  cloud = storage::loadCloud();
  if (!cloud.valid() && strlen(XG_FALLBACK_BROKER_HOST)) {
    cloud.host = XG_FALLBACK_BROKER_HOST;
    cloud.port = XG_FALLBACK_BROKER_PORT;
  }
  client.setBufferSize(MQTT_MAX_PACKET_SIZE);
  client.setKeepAlive(MQTT_KEEPALIVE_SEC);
  client.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SEC);
  client.setCallback(onMessage);
  if (XG_HAS_CA_CERT) tlsClient.setCACert(XG_CA_CERT);
  else tlsClient.setInsecure();  // encrypted but unauthenticated — add certs/ca.pem for production
}

static bool tryConnect() {
  if (!cloud.valid()) return false;
  IPAddress ip;
  dnsFailure = !WiFi.hostByName(cloud.host.c_str(), ip);
  if (dnsFailure) return false;
  client.setClient(cloud.tls ? static_cast<Client&>(tlsClient) : static_cast<Client&>(plainClient));
  client.setServer(cloud.host.c_str(), cloud.port);
  const bool ok = client.connect(hwId.c_str(), cloud.username.c_str(), cloud.password.c_str(), tStatus.c_str(), 1,
                                 true, "offline", true);
  if (!ok) return false;
  client.publish(tStatus.c_str(), "online", true);
  client.subscribe(tDesired.c_str(), 1);
  client.subscribe(tCmd.c_str(), 1);
  return true;
}

void loop() {
  const int64_t now = nowMs();
  if (rebootPending && now >= rebootAt) {
    client.disconnect();
    delay(100);
    ESP.restart();
  }

  const bool wasConnected = client.connected();
  if (!wasConnected && wifi_link::connected() && cloud.valid() && now >= nextAttemptAt) {
    if (tryConnect()) {
      backoffMs = MQTT_BACKOFF_MIN_MS;
      {
        StateLock lock;
        gState.cloudConnected = true;
        gState.cloudLostSince = 0;
        gState.reportedDirty = true;
      }
      if (!bootEventSent) {
        JsonDocument data;
        data["fw"] = XG_FW_VERSION;
        data["reason"] = static_cast<int>(esp_reset_reason());
        publishEvent("boot", &data);
        bootEventSent = true;
      }
      flushBuffer();
    } else {
      nextAttemptAt = now + backoffMs;
      backoffMs = min<int64_t>(backoffMs * 2, MQTT_BACKOFF_MAX_MS);
    }
  }

  if (client.connected()) {
    client.loop();
    ota::loop();
    String otaCmd, otaErr;
    bool otaOk;
    if (ota::takeResult(otaCmd, otaOk, otaErr)) {
      ack(otaCmd.c_str(), otaOk, otaOk ? nullptr : otaErr.c_str());
      if (otaOk) {
        rebootPending = true;
        rebootAt = nowMs() + 1500;
      }
    }
  } else {
    StateLock lock;
    if (gState.cloudConnected) {
      gState.cloudConnected = false;
      gState.cloudLostSince = now;
    }
  }

  // Outbound: telemetry on interval or pump change; reported on change or heartbeat; events.
  bool pumpChanged, reportedDirty, maxRuntime;
  int8_t faultEdge;
  int32_t intervalSec;
  const bool online = client.connected();
  {
    StateLock lock;
    if (!gState.sensorsReady) return;
    pumpChanged = gState.pumpChanged;
    reportedDirty = gState.reportedDirty;
    maxRuntime = gState.maxRuntimeEvent;
    faultEdge = gState.sensorFaultEdge;
    intervalSec = gState.settings.telemetryIntervalSec;
    gState.pumpChanged = false;  // telemetry is buffered while offline
    if (online) {                // events wait until they can actually be delivered
      gState.maxRuntimeEvent = false;
      gState.sensorFaultEdge = 0;
    }
  }

  if (pumpChanged || now - lastTelemetryAt >= static_cast<int64_t>(intervalSec) * 1000) {
    lastTelemetryAt = now;
    const TelemetrySnapshot t = snapshot();
    if (!client.connected() || !publishTelemetry(t)) bufferTelemetry(t);
  }
  if (!client.connected()) return;

  if (pumpChanged || reportedDirty || now - lastReportedAt >= REPORTED_HEARTBEAT_MS) publishReported();
  if (maxRuntime) publishEvent("max_runtime");
  if (faultEdge > 0) publishEvent("sensor_fault");
  if (faultEdge < 0) publishEvent("sensor_recovered");
  if (wifi_link::takeNetworkChanged()) {
    JsonDocument data;
    data["ssid"] = wifi_link::ssid();
    publishEvent("wifi_changed", &data);
  }
}

}  // namespace mqtt_link
