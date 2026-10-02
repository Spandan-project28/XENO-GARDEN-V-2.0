#pragma once
// Why (and whether) the device advertises for Bluetooth setup — implementation_plan §15, ADR-018.
// Pure logic, unit-tested on the host (firmware/test/native).
//
//   Setup  : not configured yet, the owner opened it (5 s button hold / app command), or the
//            device is on WiFi but hasn't reached the server for a while (wrong/old server
//            address, e.g. the dev PC changed network) — so the app can link it again.
//            The claim code is readable, so the app can (re)claim the device.
//   Rejoin : configured, but no saved WiFi has worked for a while. The device asks for new WiFi
//            only: no claim code, cloud credentials refused.
//   Off    : everything is fine.
#include <stdint.h>

namespace xg {

enum class PairMode : uint8_t { Off, Setup, Rejoin };

const char* pairModeName(PairMode m);

class PairingPolicy {
 public:
  explicit PairingPolicy(int64_t afterMs = 60000) : afterMs_(afterMs) {}

  /**
   * configured     : has saved WiFi AND cloud credentials
   * setupWindow    : the owner opened setup mode and it hasn't expired
   * wifiConnected  : currently joined to a network
   * cloudConnected : connected to the server (MQTT)
   */
  PairMode update(bool configured, bool setupWindow, bool wifiConnected, bool cloudConnected, int64_t nowMs);
  PairMode mode() const { return mode_; }

 private:
  int64_t afterMs_;
  int64_t wifiLostSince_ = -1;
  int64_t cloudLostSince_ = -1;
  PairMode mode_ = PairMode::Off;
};

}  // namespace xg
