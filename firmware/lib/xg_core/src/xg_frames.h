#pragma once
// BLE write reassembly — mirror of FrameAssembler in packages/shared/src/ble.
// Frames look like "<index>/<total>:<chunk>". Pure C++ (host-testable).
#include <string>

namespace xg {

class FrameAssembler {
 public:
  enum class Result { Incomplete, Complete, Error };

  /** Feeds one frame. On Complete, `message` holds the full payload. */
  Result push(const std::string& frame, std::string& message);
  void reset();

 private:
  std::string buffer_;
  int total_ = 0;
  int next_ = 0;
};

}  // namespace xg
