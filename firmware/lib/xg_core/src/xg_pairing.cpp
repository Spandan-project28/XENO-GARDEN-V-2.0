#include "xg_pairing.h"

namespace xg {

const char* pairModeName(PairMode m) {
  switch (m) {
    case PairMode::Setup:
      return "setup";
    case PairMode::Rejoin:
      return "rejoin";
    default:
      return "off";
  }
}

PairMode PairingPolicy::update(bool configured, bool setupWindow, bool wifiConnected, int64_t nowMs) {
  // Track how long the WiFi has been gone, whatever the mode.
  if (wifiConnected) offlineSince_ = -1;
  else if (offlineSince_ < 0) offlineSince_ = nowMs;

  if (!configured || setupWindow) return mode_ = PairMode::Setup;
  if (wifiConnected) return mode_ = PairMode::Off;
  return mode_ = (nowMs - offlineSince_ >= rejoinAfterMs_) ? PairMode::Rejoin : PairMode::Off;
}

}  // namespace xg
