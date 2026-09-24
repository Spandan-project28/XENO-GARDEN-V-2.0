#include "storage.h"

#include <Preferences.h>
#include <esp_random.h>

#include "xg_contract.h"

namespace storage {

static Preferences prefs;
static const char* NS = "xg";

void begin() { prefs.begin(NS, false); }

int loadNetworks(SavedNetwork* out, int max) {
  int n = prefs.getUChar("net_n", 0);
  if (n > max) n = max;
  for (int i = 0; i < n; i++) {
    out[i].ssid = prefs.getString(("net_s" + String(i)).c_str(), "");
    out[i].password = prefs.getString(("net_p" + String(i)).c_str(), "");
  }
  return n;
}

void rememberNetwork(const String& ssid, const String& password) {
  SavedNetwork list[MAX_SAVED_NETWORKS];
  int n = loadNetworks(list, MAX_SAVED_NETWORKS);
  SavedNetwork next[MAX_SAVED_NETWORKS];
  next[0] = {ssid, password};
  int m = 1;
  for (int i = 0; i < n && m < MAX_SAVED_NETWORKS; i++) {
    if (list[i].ssid != ssid) next[m++] = list[i];
  }
  for (int i = 0; i < m; i++) {
    prefs.putString(("net_s" + String(i)).c_str(), next[i].ssid);
    prefs.putString(("net_p" + String(i)).c_str(), next[i].password);
  }
  prefs.putUChar("net_n", m);
}

CloudConfig loadCloud() {
  CloudConfig c;
  c.host = prefs.getString("c_host", "");
  c.port = prefs.getUShort("c_port", 0);
  c.tls = prefs.getBool("c_tls", false);
  c.username = prefs.getString("c_user", "");
  c.password = prefs.getString("c_pass", "");
  return c;
}

void saveCloud(const CloudConfig& c) {
  prefs.putString("c_host", c.host);
  prefs.putUShort("c_port", c.port);
  prefs.putBool("c_tls", c.tls);
  prefs.putString("c_user", c.username);
  prefs.putString("c_pass", c.password);
}

bool loadSettings(xg::DeviceSettings& s, xg::Mode& mode, uint32_t& appliedVersion) {
  String json = prefs.getString("settings", "");
  appliedVersion = prefs.getUInt("ver", 0);
  mode = prefs.getUChar("mode", 0) == 1 ? xg::Mode::Manual : xg::Mode::Auto;
  if (!json.length()) return false;
  return xg::settingsFromJson(std::string(json.c_str()), s);
}

void saveSettings(const xg::DeviceSettings& s, xg::Mode mode, uint32_t appliedVersion) {
  prefs.putString("settings", xg::settingsToJson(s).c_str());
  prefs.putUChar("mode", mode == xg::Mode::Manual ? 1 : 0);
  prefs.putUInt("ver", appliedVersion);
}

Calibration loadCalibration() {
  Calibration c;
  c.dryRaw = prefs.getInt("cal_dry", SOIL_DEFAULT_DRY_RAW);
  c.wetRaw = prefs.getInt("cal_wet", SOIL_DEFAULT_WET_RAW);
  c.dryMeasured = prefs.getBool("cal_dm", false);
  c.wetMeasured = prefs.getBool("cal_wm", false);
  return c;
}

void saveCalibration(const Calibration& c) {
  prefs.putInt("cal_dry", c.dryRaw);
  prefs.putInt("cal_wet", c.wetRaw);
  prefs.putBool("cal_dm", c.dryMeasured);
  prefs.putBool("cal_wm", c.wetMeasured);
}

String claimCode() {
  String code = prefs.getString("claim", "");
  if (code.length() == 8) return code;
  const char* alphabet = XG_CLAIM_CODE_ALPHABET;
  const size_t n = strlen(alphabet);
  code = "";
  for (int i = 0; i < 8; i++) code += alphabet[esp_random() % n];
  prefs.putString("claim", code);
  return code;
}

void factoryReset() {
  String claim = claimCode();
  Calibration cal = loadCalibration();
  prefs.clear();
  prefs.putString("claim", claim);
  saveCalibration(cal);
}

}  // namespace storage
