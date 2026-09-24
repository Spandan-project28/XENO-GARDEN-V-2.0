#include "ota.h"

#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>

#include "config.h"
#include "generated_config.h"

namespace ota {

static bool pending = false;
static bool haveResult = false;
static String pCmdId, pUrl, pSha, pVersion;
static String rCmdId, rError;
static bool rOk = false;

static bool isHex64(const String& s) {
  if (s.length() != 64) return false;
  for (size_t i = 0; i < s.length(); i++) {
    const char c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

bool schedule(const String& cmdId, const String& url, const String& sha256Hex, const String& version, String& error) {
  if (pending) {
    error = "update already in progress";
    return false;
  }
  if (!url.startsWith("https://")) {
    error = "url must be https";
    return false;
  }
  if (!isHex64(sha256Hex)) {
    error = "invalid sha256";
    return false;
  }
  if (version == XG_FW_VERSION) {
    error = "already on this version";
    return false;
  }
  pCmdId = cmdId;
  pUrl = url;
  pSha = sha256Hex;
  pVersion = version;
  pending = true;
  return true;
}

static void finish(bool ok, const String& err) {
  rCmdId = pCmdId;
  rOk = ok;
  rError = err;
  haveResult = true;
  pending = false;
}

bool takeResult(String& cmdId, bool& ok, String& error) {
  if (!haveResult) return false;
  haveResult = false;
  cmdId = rCmdId;
  ok = rOk;
  error = rError;
  return true;
}

void loop() {
  if (!pending) return;
  log_i("OTA: downloading %s (%s)", pUrl.c_str(), pVersion.c_str());

  WiFiClientSecure tls;
  // Integrity comes from the SHA-256 (delivered over the authenticated MQTT link); the CA adds
  // transport authenticity when configured.
  if (XG_HAS_CA_CERT) tls.setCACert(XG_CA_CERT);
  else tls.setInsecure();
  HTTPClient http;
  http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(tls, pUrl)) return finish(false, "bad url");
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    return finish(false, String("http ") + code);
  }
  const int len = http.getSize();
  if (len <= 0 || !Update.begin(static_cast<size_t>(len), U_FLASH)) {
    http.end();
    return finish(false, "image too large or unknown size");
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts_ret(&sha, 0);
  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[2048];
  int remaining = len;
  uint32_t lastData = millis();
  while (remaining > 0 && http.connected()) {
    const size_t avail = stream->available();
    if (!avail) {
      if (millis() - lastData > 20000) break;
      delay(5);
      continue;
    }
    const int n = stream->readBytes(buf, min(avail, sizeof(buf)));
    if (n <= 0) continue;
    lastData = millis();
    mbedtls_sha256_update_ret(&sha, buf, n);
    if (Update.write(buf, n) != static_cast<size_t>(n)) break;
    remaining -= n;
  }
  http.end();

  uint8_t digest[32];
  mbedtls_sha256_finish_ret(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (remaining != 0) {
    Update.abort();
    return finish(false, "download interrupted");
  }
  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  if (pSha != hex) {
    Update.abort();
    log_w("OTA: sha256 mismatch");
    return finish(false, "sha256 mismatch");
  }
  if (!Update.end(true)) return finish(false, String("flash: ") + Update.errorString());
  log_i("OTA: %s installed, rebooting", pVersion.c_str());
  finish(true, "");
}

}  // namespace ota
