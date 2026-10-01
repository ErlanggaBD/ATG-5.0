#!/usr/bin/env bash
# Kompilasi + jalankan uji logika gerbang berhenti firmware ATG-5.0.
# Tidak butuh Arduino IDE, board, motor, atau plat — murni kompilasi host.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p .build

g++ -std=c++17 -O1 -Wall \
  -I stubs \
  -o .build/firmware_logic_test \
  firmware_logic_test.cpp

exec ./.build/firmware_logic_test