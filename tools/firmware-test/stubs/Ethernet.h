// Stub Ethernet / EthernetUDP — cukup untuk membuat firmware bisa dikompilasi
// di host. Semua operasi jaringan jadi no-op.
#pragma once

#include "Arduino.h"

#define EthernetNoHardware 0
#define EthernetHardware 1
#define LinkON 0
#define LinkOFF 1

class IPAddress {
 public:
  IPAddress() {}
  IPAddress(unsigned int a, unsigned int b, unsigned int c, unsigned int d)
      : a_(a), b_(b), c_(c), d_(d) {}
  unsigned int a_ = 0, b_ = 0, c_ = 0, d_ = 0;
  // Konversi implisit supaya Serial.println(Ethernet.localIP()) ikut jalan.
  operator String() const {
    char buf[32];
    snprintf(buf, sizeof buf, "%u.%u.%u.%u", a_, b_, c_, d_);
    return String(buf);
  }
};

class StubEthernet {
 public:
  // Selalu melaporkan hardware ADA dan link ON supaya setup() tidak masuk
  // loop `while (true)` yang akan menggantung proses test.
  void begin(byte *mac, IPAddress ip, IPAddress gw, IPAddress sn) {
    (void)mac; ip_ = ip; gw_ = gw; sn_ = sn;
  }
  int hardwareStatus() { return EthernetHardware; }
  int linkStatus() { return LinkON; }
  IPAddress localIP() { return ip_; }

 private:
  IPAddress ip_, gw_, sn_;
};

extern StubEthernet Ethernet;