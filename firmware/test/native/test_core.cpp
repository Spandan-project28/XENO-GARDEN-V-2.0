// Host tests for firmware/lib/xg_core — run with: python firmware/test/run_native.py
#include <ArduinoJson.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include <fstream>
#include <sstream>
#include <string>

#include "xg_automation.h"
#include "xg_frames.h"
#include "xg_shadow.h"

static int g_failed = 0;
static int g_passed = 0;

#define CHECK(cond, msg)                                                   \
  do {                                                                     \
    if (cond) {                                                            \
      g_passed++;                                                          \
    } else {                                                               \
      g_failed++;                                                          \
      printf("  FAIL %s:%d  %s  [%s]\n", __FILE__, __LINE__, #cond, msg); \
    }                                                                      \
  } while (0)

using namespace xg;

// ── golden automation vectors (shared with the TypeScript implementation) ──
static void readInput(JsonObjectConst o, Input& in) {
  if (o["now"].is<int64_t>()) in.now = o["now"].as<int64_t>();
  if (o["mode"].is<const char*>()) in.mode = strcmp(o["mode"], "manual") == 0 ? Mode::Manual : Mode::Auto;
  if (!o["soilMoisture"].isUnbound()) {
    in.soilValid = !o["soilMoisture"].isNull();
    in.soilMoisture = in.soilValid ? o["soilMoisture"].as<float>() : NAN;
  }
  if (o["rain"].is<bool>()) in.rain = o["rain"];
  if (o["pumpOn"].is<bool>()) in.pumpOn = o["pumpOn"];
  if (o["pumpSince"].is<int64_t>()) in.pumpSince = o["pumpSince"].as<int64_t>();
  if (!o["cooldownUntil"].isUnbound()) {
    in.cooling = !o["cooldownUntil"].isNull();
    in.cooldownUntil = in.cooling ? o["cooldownUntil"].as<int64_t>() : 0;
  }
  if (!o["manual"].isUnbound()) {
    memset(&in.manual, 0, sizeof(in.manual));
    JsonObjectConst m = o["manual"];
    if (!m.isNull()) {
      in.manual.active = true;
      strncpy(in.manual.cmdId, m["cmdId"] | "", 40);
      in.manual.pump = strcmp(m["pump"] | "", "ON") == 0 ? PumpAction::On : PumpAction::Off;
      in.manual.expiresAt = m["expiresAt"].as<int64_t>();
    }
  }
  JsonObjectConst s = o["settings"];
  if (!s.isNull()) {
    if (!s["moistureLow"].isUnbound()) in.settings.moistureLow = s["moistureLow"];
    if (!s["moistureHigh"].isUnbound()) in.settings.moistureHigh = s["moistureHigh"];
    if (!s["maxPumpRunSec"].isUnbound()) in.settings.maxPumpRunSec = s["maxPumpRunSec"];
    if (!s["cooldownSec"].isUnbound()) in.settings.cooldownSec = s["cooldownSec"];
    if (!s["rainLockout"].isUnbound()) in.settings.rainLockout = s["rainLockout"];
  }
}

static void testVectors(const char* path) {
  printf("automation vectors (%s)\n", path);
  std::ifstream f(path);
  CHECK(f.good(), "vectors file readable");
  std::stringstream ss;
  ss << f.rdbuf();
  JsonDocument doc;
  CHECK(!deserializeJson(doc, ss.str()), "vectors parse");
  JsonArrayConst cases = doc["cases"];
  CHECK(cases.size() >= 25, "at least 25 vectors");
  for (JsonObjectConst c : cases) {
    Input in;
    memset(&in, 0, sizeof(in));
    readInput(doc["base"], in);
    readInput(c["input"], in);
    JsonObjectConst settingsOverride = c["settings"];
    if (!settingsOverride.isNull()) {
      JsonDocument wrap;
      wrap["settings"] = settingsOverride;
      readInput(wrap.as<JsonObjectConst>(), in);
    }
    Output out = evaluate(in);
    JsonObjectConst e = c["expected"];
    const char* name = c["name"];
    CHECK(out.pumpOn == e["pumpOn"].as<bool>(), name);
    CHECK(strcmp(reasonName(out.reason), e["reason"]) == 0, name);
    CHECK(out.pumpSince == e["pumpSince"].as<int64_t>(), name);
    const bool expCooling = !e["cooldownUntil"].isNull();
    CHECK(out.cooling == expCooling, name);
    if (expCooling) CHECK(out.cooldownUntil == e["cooldownUntil"].as<int64_t>(), name);
    const bool expManual = !e["manual"].isNull();
    CHECK(out.manual.active == expManual, name);
    if (expManual) CHECK(strcmp(out.manual.cmdId, e["manual"]["cmdId"]) == 0, name);
  }
}

static void testCalibration() {
  printf("calibration\n");
  float v = -1;
  CHECK(rawToMoisture(3000, 3000, 1200, v) && v == 0.0f, "dry");
  CHECK(rawToMoisture(1200, 3000, 1200, v) && v == 100.0f, "wet");
  CHECK(rawToMoisture(2100, 3000, 1200, v) && v == 50.0f, "half");
  CHECK(rawToMoisture(1000, 500, 3500, v) && fabsf(v - 16.7f) < 0.05f, "resistive direction");
  CHECK(rawToMoisture(3500, 3000, 1200, v) && v == 0.0f, "clamp low");
  CHECK(!rawToMoisture(0, 3000, 1200, v), "rail low is fault");
  CHECK(!rawToMoisture(4095, 3000, 1200, v), "rail high is fault");
  CHECK(!rawToMoisture(2000, 2000, 2050, v), "bad calibration");
  int a[] = {5, 1, 9, 3, 7};
  CHECK(median(a, 5) == 5, "median odd");
  int b[] = {4, 1, 3, 2};
  CHECK(median(b, 4) == 2, "median even");
}

static void testFrames() {
  printf("ble frames\n");
  FrameAssembler asm1;
  std::string msg;
  CHECK(asm1.push("0/1:{\"a\":1}", msg) == FrameAssembler::Result::Complete && msg == "{\"a\":1}", "single");
  CHECK(asm1.push("0/3:ab", msg) == FrameAssembler::Result::Incomplete, "f0");
  CHECK(asm1.push("1/3:cd", msg) == FrameAssembler::Result::Incomplete, "f1");
  CHECK(asm1.push("2/3:ef", msg) == FrameAssembler::Result::Complete && msg == "abcdef", "f2");
  CHECK(asm1.push("0/2:ab", msg) == FrameAssembler::Result::Incomplete, "restart");
  CHECK(asm1.push("0/3:zz", msg) == FrameAssembler::Result::Incomplete, "new message resets");
  CHECK(asm1.push("2/3:zz", msg) == FrameAssembler::Result::Error, "out of order");
  CHECK(asm1.push("garbage", msg) == FrameAssembler::Result::Error, "malformed");
  CHECK(asm1.push("5/3:x", msg) == FrameAssembler::Result::Error, "index beyond total");
  CHECK(asm1.push("0/1:Caf\xC3\xA9 \xF0\x9F\x8C\xBF", msg) == FrameAssembler::Result::Complete &&
            msg == "Caf\xC3\xA9 \xF0\x9F\x8C\xBF",
        "utf8 passthrough");
}

static void testShadow() {
  printf("desired shadow\n");
  const char* ok =
      "{\"version\":7,\"mode\":\"manual\",\"settings\":{\"moistureLow\":25,\"moistureHigh\":55,\"maxPumpRunSec\":900,"
      "\"cooldownSec\":120,\"rainLockout\":false,\"highTempC\":35,\"telemetryIntervalSec\":10},"
      "\"manual\":{\"cmdId\":\"abcd1234\",\"pump\":\"ON\",\"durationSec\":600,\"issuedAt\":1000,\"expiresAt\":601000}}";
  Desired d;
  std::string err;
  CHECK(parseDesired(ok, strlen(ok), d, err), err.c_str());
  CHECK(d.version == 7 && d.mode == Mode::Manual, "version/mode");
  CHECK(d.settings.maxPumpRunSec == 900 && !d.settings.rainLockout && d.settings.telemetryIntervalSec == 10, "settings");
  CHECK(d.manual.present && strcmp(d.manual.cmdId, "abcd1234") == 0 && d.manual.pump == PumpAction::On, "manual");

  const char* noManual =
      "{\"version\":2,\"mode\":\"auto\",\"settings\":{\"moistureLow\":30,\"moistureHigh\":45,\"maxPumpRunSec\":600,"
      "\"cooldownSec\":300,\"rainLockout\":true},\"manual\":null}";
  CHECK(parseDesired(noManual, strlen(noManual), d, err) && !d.manual.present, "null manual");
  CHECK(d.settings.highTempC == 38 && d.settings.telemetryIntervalSec == 5, "optional defaults");

  const char* evil =
      "{\"version\":3,\"mode\":\"auto\",\"settings\":{\"moistureLow\":99,\"moistureHigh\":10,\"maxPumpRunSec\":999999,"
      "\"cooldownSec\":0,\"rainLockout\":true,\"telemetryIntervalSec\":0}}";
  CHECK(parseDesired(evil, strlen(evil), d, err), "evil parses but clamps");
  CHECK(d.settings.maxPumpRunSec == 3600 && d.settings.cooldownSec == 30, "runtime/cooldown clamped");
  CHECK(d.settings.moistureHigh - d.settings.moistureLow >= 5, "hysteresis gap enforced");
  CHECK(d.settings.telemetryIntervalSec == 2, "telemetry clamped");

  const char* bad[] = {"{", "{\"mode\":\"auto\"}", "{\"version\":1,\"mode\":\"turbo\",\"settings\":{}}",
                       "{\"version\":1,\"mode\":\"auto\",\"settings\":{\"moistureLow\":\"x\"}}"};
  for (const char* b : bad) CHECK(!parseDesired(b, strlen(b), d, err), b);

  DeviceSettings s = defaultSettings();
  s.moistureLow = 22;
  DeviceSettings back;
  CHECK(settingsFromJson(settingsToJson(s), back) && back.moistureLow == 22 && back.maxPumpRunSec == 600, "roundtrip");
}

static void testManualClock() {
  printf("manual command clock conversion\n");
  DesiredManual m;
  memset(&m, 0, sizeof(m));
  m.present = true;
  strcpy(m.cmdId, "cmd-1");
  m.pump = PumpAction::On;
  m.durationSec = 600;
  m.issuedAt = 1'000'000;
  m.expiresAt = 1'600'000;
  ManualCommand c = manualToLocal(m, 5'000, 1'100'000);  // synced clock: 500 s left
  CHECK(c.active && c.expiresAt == 5'000 + 500'000, "synced remaining");
  c = manualToLocal(m, 5'000, 0);  // no clock: full duration
  CHECK(c.active && c.expiresAt == 5'000 + 600'000, "unsynced uses duration");
  c = manualToLocal(m, 5'000, 2'000'000);  // already expired
  CHECK(!c.active, "expired dropped");
  c = manualToLocal(m, 5'000, 10);  // clock far behind: capped to duration
  CHECK(c.active && c.expiresAt == 5'000 + 600'000, "skew capped");
}

int main(int argc, char** argv) {
  const char* vectors = argc > 1 ? argv[1] : "../packages/shared/test-vectors/automation.json";
  testVectors(vectors);
  testCalibration();
  testFrames();
  testShadow();
  testManualClock();
  printf("\n%d checks passed, %d failed\n", g_passed, g_failed);
  return g_failed ? 1 : 0;
}
