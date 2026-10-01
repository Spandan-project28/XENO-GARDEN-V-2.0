#pragma once
// Why (and whether) the device advertises for Bluetooth setup — implementation_plan §15, ADR-018.
// Pure logic, unit-tested on the host (firmware/test/native).
//
//   Setup  : not configured yet, or the owner opened it (5 s button hold / app command).
//            The claim code is readable, so the app can claim the device.
//   Rejoin : configured, but no saved WiFi has worked for a while. The device asks for new WiFi
//            only: no claim code, cloud credentials refused — nobody nearby can take it over.
//   Off    : everything is fine.
#include <stdint.h>

namespace xg {

enum class PairMode : uint8_t { Off, Setup, Rejoin };

const char* pairModeName(PairMode m);

class PairingPolicy {
 public:
  explicit PairingPolicy(int64_t rejoinAfterMs = 120000) : rejoinAfterMs_(rejoinAfterMs) {}

  /**
   * configured    : has saved WiFi AND cloud credentials
   * setupWindow   : the owner opened setup mode and it hasn't expired
   * wifiConnected : currently joined to a network
   */
  PairMode update(bool configured, bool setupWindow, bool wifiConnected, int64_t nowMs);
  PairMode mode() const { return mode_; }

 private:
  int64_t rejoinAfterMs_;
  int64_t offlineSince_ = -1;
  PairMode mode_ = PairMode::Off;
};

}  // namespace xg
