// ===========================================================================
// STUB ARDUINO — KHUSUS UJI LOGIKA DI HOST (bukan untuk flash ke board)
// ---------------------------------------------------------------------------
// Tujuannya: mengompilasi Basic_Test_UDP.ino yang ASLI di luar Arduino IDE
// lalu memanggilnya dengan simulasi sensor, sehingga gerbang berhenti berbasis
// rotasi bisa dibuktikan tanpa board, tanpa motor, tanpa plat.
//
// Stub ini sengaja dibuat sangat kecil: hanya API yang benar-benar dipakai
// firmware. digitalRead(sensePin) disambungkan ke hook supaya test bisa
// memutuskan apakah plat ada di posisi fisik tertentu.
// ===========================================================================
#pragma once

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

typedef uint8_t byte;
typedef bool boolean;

#define HIGH 1
#define LOW  0
#define INPUT        0
#define OUTPUT       1
#define INPUT_PULLUP 2

#define A0 14
#define A1 15

// Keadaan pin + hook test
extern int stub_pinState[64];
extern int (*stubDigitalReadHook)(int pin);

void pinMode(int pin, int mode) { (void)pin; (void)mode; }
void digitalWrite(int pin, int val) { if (pin >= 0 && pin < 64) stub_pinState[pin] = val; }
int  digitalRead(int pin) {
  if (stubDigitalReadHook) return stubDigitalReadHook(pin);
  return (pin >= 0 && pin < 64) ? stub_pinState[pin] : LOW;
}
// Delay asli memblokir; untuk test diasumsikan 0 agar simulasi cepat.
void delay(unsigned long ms) { (void)ms; }
void delayMicroseconds(unsigned int us) { (void)us; }

// ---------------------------------------------------------------------------
// String — subset minimal yang dipakai firmware (konversi & Operator +)
// ---------------------------------------------------------------------------
class String {
 public:
  String() {}
  String(const char *c) : s_(c ? c : "") {}
  String(char c) : s_(1, c) {}
  String(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); s_ = b; }
  String(long v) { char b[32]; snprintf(b, sizeof b, "%ld", v); s_ = b; }
  String(unsigned int v) { char b[32]; snprintf(b, sizeof b, "%u", v); s_ = b; }
  String(unsigned long v) { char b[32]; snprintf(b, sizeof b, "%lu", v); s_ = b; }
  String(float v) { char b[64]; snprintf(b, sizeof b, "%.2f", v); s_ = b; }
  String(double v) { char b[64]; snprintf(b, sizeof b, "%.2f", v); s_ = b; }

  const char *c_str() const { return s_.c_str(); }
  unsigned int length() const { return (unsigned int)s_.size(); }
  char charAt(unsigned int i) const { return i < s_.size() ? s_[i] : '\0'; }

  String &operator+=(const String &o) { s_ += o.s_; return *this; }
  String &operator+=(const char *o) { s_ += o; return *this; }
  String &operator+=(char c) { s_ += c; return *this; }

  int toInt() const { return atoi(s_.c_str()); }
  long toInt32() const { return atol(s_.c_str()); }

  void trim() {
    size_t b = s_.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) { s_.clear(); return; }
    size_t e = s_.find_last_not_of(" \t\r\n");
    s_ = s_.substr(b, e - b + 1);
  }
  bool startsWith(const String &p) const { return s_.rfind(p.s_, 0) == 0; }
  String substring(unsigned int from) const {
    return String(from < s_.size() ? s_.substr(from).c_str() : "");
  }
  std::string str() const { return s_; }

 private:
  std::string s_;
};

inline String operator+(String a, const String &b) { a += b; return a; }
inline String operator+(String a, const char *b) { a += b; return a; }
inline String operator+(String a, char c) { a += c; return a; }

// ---------------------------------------------------------------------------
// Serial — akumulasi output supaya test bisa memeriksa pesan yang dikirim
// ---------------------------------------------------------------------------
extern std::string stub_serialOut;

class StubSerial {
 public:
  void begin(unsigned long) {}
  int available() { return 0; }
  int read() { return -1; }
  void print(const char *s) { stub_serialOut += s; }
  void print(const String &s) { stub_serialOut += s.c_str(); }
  void print(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); stub_serialOut += b; }
  void print(char c) { stub_serialOut += c; }
  void println() { stub_serialOut += "\n"; }
  void println(const char *s) { stub_serialOut += s; stub_serialOut += "\n"; }
  void println(const String &s) { stub_serialOut += s.c_str(); stub_serialOut += "\n"; }
  void println(int v) { char b[32]; snprintf(b, sizeof b, "%d", v); stub_serialOut += b; stub_serialOut += "\n"; }
  void println(char c) { stub_serialOut += c; stub_serialOut += "\n"; }
};
extern StubSerial Serial;