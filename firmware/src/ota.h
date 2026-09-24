#pragma once
// Over-the-air firmware update. The server's release channel supplies an HTTPS URL, the image's
// SHA-256 and its version (never user-supplied). The image is streamed into the inactive OTA slot
// and only activated if the SHA-256 matches. The pump safety task keeps running throughout.
#include <Arduino.h>

namespace ota {

/** Schedules an update. Returns false (with a reason) if the request is invalid. */
bool schedule(const String& cmdId, const String& url, const String& sha256Hex, const String& version, String& error);
/** Runs a scheduled update (blocking while downloading; called from the network loop). */
void loop();
/** Final result of the last update, once. */
bool takeResult(String& cmdId, bool& ok, String& error);

}  // namespace ota
