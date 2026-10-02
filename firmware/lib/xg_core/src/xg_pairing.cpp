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

PairMode PairingPolicy::update(bool configured, bool setupWindow, bool wifiConnected, bool cloudConnected,
                               int64_t nowMs) {
  // How long the WiFi / the server have been unreachable, whatever the mode.
  if (wifiConnected) wifiLostSince_ = -1;
  else if (wifiLostSince_ < 0) wifiLostSince_ = nowMs;
  // The server clock only runs while WiFi is up (the server can't be reached without it anyway).
  if (cloudConnected || !wifiConnected) cloudLostSince_ = -1;
  else if (cloudLostSince_ < 0) cloudLostSince_ = nowMs;

  if (!configured || setupWindow) return mode_ = PairMode::Setup;
  if (cloudConnected) return mode_ = PairMode::Off;
  if (!wifiConnected) {
    return mode_ = (nowMs - wifiLostSince_ >= afterMs_) ? PairMode::Rejoin : PairMode::Off;
  }
  // On WiFi but the server never answers: the stored server details are probably stale.
  return mode_ = (nowMs - cloudLostSince_ >= afterMs_) ? PairMode::Setup : PairMode::Off;
}

}  // namespace xg
