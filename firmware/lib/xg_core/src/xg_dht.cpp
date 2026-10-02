#include "xg_dht.h"

namespace xg {

bool decodeDht(const uint8_t d[5], bool dht22, float& tempC, float& humidity) {
  if (d[0] == 0 && d[1] == 0 && d[2] == 0 && d[3] == 0 && d[4] == 0) return false;  // line stuck low
  if (static_cast<uint8_t>(d[0] + d[1] + d[2] + d[3]) != d[4]) return false;
  float t, h;
  if (dht22) {
    h = static_cast<float>((d[0] << 8) | d[1]) * 0.1f;
    t = static_cast<float>(((d[2] & 0x7F) << 8) | d[3]) * 0.1f;
    if (d[2] & 0x80) t = -t;
  } else {
    h = static_cast<float>(d[0]) + static_cast<float>(d[1]) * 0.1f;
    t = static_cast<float>(d[2]) + static_cast<float>(d[3] & 0x0F) * 0.1f;
    if (d[3] & 0x80) t = -t;
  }
  if (h < 0.0f || h > 100.0f || t < -40.0f || t > 85.0f) return false;
  tempC = t;
  humidity = h;
  return true;
}

}  // namespace xg
