// Stub EthernetUDP — no-op, cukup agar firmware bisa dikompilasi di host.
#pragma once

#include "Ethernet.h"

class StubEthernetUDP {
 public:
  void begin(unsigned int) {}
  void beginPacket(IPAddress, unsigned int) {}
  void endPacket() {}
  // respond() menulis lewat Udp saat sumber perintah adalah UDP.
  void print(const String &s) { stub_serialOut += s.c_str(); }
  void print(const char *s) { stub_serialOut += s; }
  int parsePacket() { return 0; }
  int read(char *buf, int len) { (void)buf; (void)len; return 0; }
  IPAddress remoteIP() { return IPAddress(); }
  unsigned int remotePort() { return 0; }
};

// Firmware mendeklarasikan `EthernetUDP Udp;` — nama itu harus ada di stub.
typedef StubEthernetUDP EthernetUDP;