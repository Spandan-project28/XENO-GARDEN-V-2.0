#pragma once
#include <Arduino.h>
#include <esp_timer.h>
#include <time.h>

/** Monotonic milliseconds since boot (64-bit: never wraps, unlike millis()). */
inline int64_t nowMs() { return esp_timer_get_time() / 1000; }

/** Wall-clock epoch ms once NTP has synced, otherwise 0. */
inline int64_t epochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec < 1700000000) return 0;  // not synced yet
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

inline void startTimeSync() { configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com"); }
