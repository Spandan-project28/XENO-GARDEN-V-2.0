#include "xg_frames.h"

#include <stdlib.h>

namespace xg {

static bool parseInt(const std::string& s, size_t from, size_t to, int& out) {
  if (from >= to || to - from > 5) return false;
  int v = 0;
  for (size_t i = from; i < to; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + (s[i] - '0');
  }
  out = v;
  return true;
}

void FrameAssembler::reset() {
  buffer_.clear();
  total_ = 0;
  next_ = 0;
}

FrameAssembler::Result FrameAssembler::push(const std::string& frame, std::string& message) {
  const size_t slash = frame.find('/');
  const size_t colon = frame.find(':');
  int index = 0;
  int total = 0;
  if (slash == std::string::npos || colon == std::string::npos || slash > colon ||
      !parseInt(frame, 0, slash, index) || !parseInt(frame, slash + 1, colon, total) || total <= 0 ||
      index >= total) {
    reset();
    return Result::Error;
  }
  if (index == 0) {
    reset();
    total_ = total;
  }
  if (total != total_ || index != next_) {
    reset();
    return Result::Error;
  }
  buffer_.append(frame, colon + 1, std::string::npos);
  next_++;
  if (buffer_.size() > 2048) {  // guard against abuse
    reset();
    return Result::Error;
  }
  if (next_ == total_) {
    message.swap(buffer_);
    reset();
    return Result::Complete;
  }
  return Result::Incomplete;
}

}  // namespace xg
