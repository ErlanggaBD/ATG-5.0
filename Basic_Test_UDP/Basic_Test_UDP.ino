/*
 * Basic_Test_UDP.ino
 * ---------------------------------------------------------------------------
 * Turunan dari Basic_Test.ino (TIDAK memodifikasi Basic_Test.ino asli).
 * Menambahkan jalur perintah UDP (Ethernet shield W5100) di samping jalur
 * Serial yang sudah ada, sehingga stepper bisa dikontrol dari desktop app
 * melalui LAN (UDP) — dengan logika pergerakan yang SAMA PERSIS dengan
 * Basic_Test.ino.
 *
 * Protokol UDP (port 8888, IP 192.168.1.103):
 *   y         -> OK                   (ping / verifikasi koneksi)
 *   + atau x  -> MAJU/READY ... HOME_DONE  (kalibrasi HOME: motor jalan ke arah
 *                ujung rel ~13 m sampai A1 terpicu, posisi -> 17700)
 *   - atau @0 -> MUNDUR ... ZERO_DONE (kalibrasi ZERO: motor mundur sampai A1
 *                terpicu di ujung bawah, posisi -> 4700)
 *   @<mm>     -> POS_DONE:<mm>        (pindah ke posisi absolut mm; butuh home+zero)
 *                NOT_HOMED            (dibalas bila dikirim sebelum HOME_DONE)
 *                NOT_ZEROED           (dibalas bila sudah HOME tapi belum ZERO)
 *   % atau #  -> ACK ... UKUR_DONE    (toggle mode ukur; butuh home + zero)
 *   s         -> ESTOP                (emergency stop, memotong semua loop gerak)
 *
 * KALIBRASI BERTINGKAT (sesuai alur operator):
 *   Saat program baru dinyalakan HANYA HOME (`+`/`x`) yang boleh dijalankan.
 *   Motor berjalan ke arah ujung rel (~13 m) sampai sensor A1 (plat pemicu di
 *   ujung atas) mendeteksi -> HOME_DONE (posisi 17700). Setelah itu ZERO
 *   (`-`/`@0`) boleh: motor mundur sampai A1 (plat pemicu di ujung bawah)
 *   mendeteksi -> ZERO_DONE (posisi 4700). Baru setelah ZERO_DONE penggerakan
 *   posisi (@<mm>) dan mode ukur (%) boleh dijalankan. Sebelum HOME_DONE
 *   balasan untuk - / @0 / @<mm> / % adalah NOT_HOMED; setelah HOME tapi belum
 *   ZERO_DONE balasan untuk @<mm> / % adalah NOT_ZEROED.
 *
 * SKALA POSISI (ATG-5.0) — angka posisi memakai SKALA-LABEL di rel (5..17 m),
 *   bukan jarak fisik dari ujung. Rel fisiknya hanya ~13 m. Lihat define
 *   ZERO_ORIGIN_MM / HOME_ORIGIN_MM untuk penjelasan & cara tuning.
 *
 * VALIDASI SENSOR NYATA (perubahan dari Basic_Test.ino):
 *   HOME/ZERO baru dianggap SAH bila sensor A1 benar-benar berubah dari idle
 *   (LOW) menjadi HIGH SELAGI motor bergerak — operator menekan tombol simulasi
 *   sesaat saat kereta tiba di titik acuan, atau kereta tiba di plat pemicu
 *   asli. Sensor yang macet HIGH sejak awal (mis. pull-down hilang / kabel
 *   putus) TIDAK akan memvalidasi, sehingga ZERO / gerakan posisi tetap
 *   terkunci di aplikasi (aman).
 *
 * SENSOR A0 (sensePin) — PENANDA METER DI REL (satu flag tiap meter, label 5-17 m):
 *   Pola baca persis seperti A1 (HIGH = terdeteksi). Mode pin mengikuti
 *   #define SENSOR_BUTTON_PLUS5V (INPUT) / SENSOR_NC_PLATE (INPUT_PULLUP).
 *   Selama gerakan posisi @<mm> (naik/turun) setelah kalibrasi, tiap step dicek.
 *   ATG-5.0: A0 TIDAK lagi menyinkronkan posisi — posisi selalu dari hitungan
 *   ROTASI. A0 hanya boleh menghentikan motor bila jarak rotasinya sudah dalam
 *   jendela STOP_TOLERANCE_MM dari target (lihat checkA0Flag). Karena itu plat
 *   yang terlewat di tengah perjalanan (mis. operator mulai pengujian di titik
 *   8 m, jadi plat 5 m dilewati) hanya tercatat sebagai
 *   "SENSOR:A0_HIGH;FLAG=<meter>" lalu motor terus berjalan tanpa mengubah
 *   posisi. A0 tidak aktif saat homing (HOME/ZERO) dan jog ukur.
 *
 * ARAH GERAK (koordinat posisi skala-label; 0 TIDAK dipakai — titik paling
 * bawah yang dipakai adalah 4700 di limit A1 ujung bawah / "ZERO"):
 *   + (HIGH) = menuju ujung atas / HOME = posisi MEMBESAR (naik)
 *   - (LOW)  = menuju ZERO (limit bawah) = posisi MENGEcil (turun)
 *   (Catatan komisioning: jika arah motor terbalik pada fisiknya, cukup
 *   pertukarkan HIGH/LOW pada Move*ByRot / Move*_Init.)
 *
 * Setiap perintah gerak baru otomatis me-reset flag ESTOP.
 * Jalur Serial (9600 baud) tetap aktif untuk debugging.
 *
 * Perbedaan perilaku yang disengaja dari Basic_Test.ino:
 * 1) MoveMaju_Init / MoveMundur_Init / MoveKiri_Init (perintah + / - / x)
 *    menyelesaikan penuh sampai A1 terpicu lalu membalas HOME_DONE / ZERO_DONE,
 *    sehingga desktop app mendapat umpan balik selesai bergerak.
 * 2) Token akhir mode ukur memakai "UKUR_DONE" (bukan "OK") agar tidak
 *    tertukar dengan balasan ping "y" yang juga "OK".
 * 3) Dukungan sensor penanda meter A0 + pengunci kalibrasi bertingkat
 *    (homeDone lalu zeroDone) — tambahan dari versi UDP sebelumnya.
 * 4) Validasi sensor nyata untuk HOME/ZERO (wajib LOW di awal gerak lalu HIGH
 *    saat bergerak) — lihat komentar "VALIDASI SENSOR NYATA".
 * ---------------------------------------------------------------------------
 */
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>

// --- Konfigurasi jaringan (sesuaikan dengan LAN Anda) ---
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xEE, 0xD1 };
IPAddress ip(192, 168, 1, 103);        // alamat firmware di LAN
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
unsigned int localPort = 8888;         // port UDP (cocok dengan default desktop app)
EthernetUDP Udp;
char packetBuffer[64];

// --- Konfigurasi motor (sama dengan Basic_Test.ino) ---
/// GEAR BOX 1:5, RADIUS = 15MM, KELILING = 47.1MM
#define dirPin 5
#define stepPin 4
#define limitPin A1
#define sensePin A0 // sensor penanda meter di rel (satu flag tiap meter, label 5-17 m); pola baca sama seperti A1
// --- Jenis sensor & mode pin (pilih salah satu lalu kompilasi ulang) ---
//   SENSOR_BUTTON_PLUS5V (default, untuk bench/simulasi tombol):
//      tombol ditekan = sinyal +5V; resistor 10k pull-down pin->GND, jadi
//      idle = LOW dan terdeteksi (ditekan / kena plat) = HIGH.
//      Pin dipakai mode INPUT (tanpa pull-up internal) agar pull-down eksternal
//      yang menentukan tegangan idle.
//   SENSOR_NC_PLATE (untuk sensor plat asli normally-closed, aktif-HIGH):
//      idle = LOW (kontak NC tertutup ke GND), terdeteksi = HIGH (lepas).
//      Pin dipakai mode INPUT_PULLUP (pull-up internal saat kontak lepas).
#define SENSOR_BUTTON_PLUS5V
#ifdef SENSOR_BUTTON_PLUS5V
#define SENSOR_PIN_MODE INPUT
#else
#define SENSOR_PIN_MODE INPUT_PULLUP
#endif
#define enaPin 6
#define stepsPerRevolution 1600 // sesuaikan dengan settingan SW1-SW3 pada modul motor driver
#define speedFast 30
#define speedMedium 200
#define speedSlow 500
#define speedSlow2 5000
// ATG-5.0 — jendela toleransi (dipakai validasi) dalam MILIMETER.
// Acuan utama berhenti motor adalah JARAK ROTASI (bukan sensor). Sensor A0
// hanya dianggap "di titik" bila jarak rotasinya juga cocok dalam jendela ini.
// Kalau A0 tidak pernah HIGH sampai target tercapai, motor menelusuri sampai
// kelebihan sebesar nilai ini lalu berhenti paksa dan aplikasi memberi tahu
// operator bahwa pengukuran diambil di luar titik.
// Resolusi rotasi = 1/84,2 langkah/mm = 0,012 mm/langkah, jadi angka ini
// belanja hanya ~2.525 langkah untuk 30 mm — aman untuk stepper.
// Untuk tuning di lapangan: ubah HANYA angka di bawah, lalu compile ulang.
#define STOP_TOLERANCE_MM 30      // 30 mm = 3,0 cm (batas bawah 20, batas atas 50)

// --- ATG-5.0 — ASAL SKALA POSISI (offset titik nol) -----------------------
// PENTING: posisi di seluruh firmware ini memakai SKALA-LABEL yang tertera di
// rel (5 m .. 17 m), BUKAN jarak fisik dari ujung rel. Rel fisiknya hanya
// ~13 m, sedangkan skala nominalnya 17 m. Hasil lapangan:
//   * limit A1 ujung bawah (ZERO) berada di belakang plat berlabel 5 m
//   * jarak ZERO -> plat label 5 m  = 300 mm (bukan 5000 mm)
//   * jarak antar plat berdekatan   = 1000 mm (sama dengan labelnya)
//   * panjang rel total             = ~13.000 mm
//   * plat label 17 m ada di 12.300 mm; sisa 0,7 m ke limit A1 ujung atas
// Maka saat motor berada di limit ZERO, koordinat SKALA-LABEL-nya bukan 0
// melainkan 5000 - 300 = 4700. Dengan begitu:
//   @5000 dari ZERO -> tempuh  300 mm  (plat pertama, benar-benar dekat)
//   @5000 -> @6000   -> tempuh 1000 mm  (sama seperti plat berikutnya)
//   @17000 dari ZERO -> tempuh 12.300 mm (plat terakhir)
// Semua logika stop/toleransi/sensor tetap memakai skala-label ini, jadi
// TIDAK ada lagi koreksi di dalam funkcinya.
// Untuk tuning di lapangan: ukur jarak ZERO -> plat 5 m dengan meteran, lalu
// ubah HANYA angka di bawah. Rumus: ZERO_ORIGIN_MM = 5000 - jarak_ukur_mm.
#define ZERO_ORIGIN_MM 4700       // koordinat skala-label saat di limit A1 ujung bawah
#define HOME_ORIGIN_MM 17700      // koordinat skala-label saat di limit A1 ujung atas
                                  // (13.000 mm fisik + 4.700 offset)
#define readyPin 7 // Green
#define warningPin 3 // Yellow
#define redPin 2 // Red

int delayMotors = speedSlow;

float keliling = 19;
bool flagInit = false;
bool ukurIsMundur = false;
int posisi = 0;
float stepsPerMM;

// --- State tambahan untuk UDP & E-STOP ---
bool estopActive = false;
unsigned long cmdCounter = 0;

// --- State sensor penanda meter (A0) & pengunci kalibrasi bertingkat ---
bool homeDone = false;       // true setelah A1 terpicu di ujung HOME (posisi 17700)
bool zeroDone = false;       // true setelah A1 terpicu di ujung ZERO (<5 m)
int moveTargetMm = -1;       // target (mm) perintah @<mm> aktif; -1 = tidak ada stop via A0
int moveStartPosMM = 0;      // posisi (mm) saat gerakan posisi dimulai
char moveDir = 'U';          // 'U' = posisi naik, 'D' = posisi turun
long moveSteps = 0;          // langkah step yang sudah ditempuh pada gerakan posisi aktif
bool sensorArrived = false;  // true = motor berhenti karena flag target (A0) terdeteksi
bool a0HighLogged = false;   // true = penekanan A0 sudah dilaporkan ke log (sekali per tekan)
// Posisi pillar SAAT A0 terpicu, TIDAK dibulatkan ke meter bulat (mm).
// ATG-5.0: `posisi` TIDAK lagi dibulatkan ke meter bulat. Sebelumnya nilai ini
// diisi dari meter bulat (flagMeter * 1000) sehingga error pembulatan
// terakumulasi ke perintah berikutnya: satu penolakan 0,4 m saja sudah membuat
// perhitungan jarak perintah berikutnya salah, lalu motor berhenti/meleset lagi.
// Sekarang `posisi` selalu disalin dari hitungan ROTASI (presisi 0,012 mm).
long a0ApproxMM = -1;

// --- ATG-5.0: vonis kedatangan (rotasi + sensor) -----------------------
// Keberhasilan sebuah titik ditentukan DUA hal sekaligus:
//   (1) jarak ROTASI sudah sampai di dalam jendela STOP_TOLERANCE_MM dari
//       target — inilah acuan utama, dihitung dari jumlah langkah step; dan
//   (2) sensor A0 benar-benar HIGH di atas plat pada jarak itu.
// Kalau (2) gagal sementara (1) sudah tercapai, motor menelusuri sampai
// kelebihan STOP_TOLERANCE_MM lalu berhenti paksa. Hasilnya dilaporkan ke
// aplikasi sebagai status "melewati titik" supaya operator memutuskan sendiri
// mau mengisikan nilai atau melewati titiknya.
bool sensorConfirmed = false;  // true = A0 HIGH DALAM jendela toleransi
// (actualStopMM / arrivalDeltaMM tidak disimpan: kedua angka itu sudah ikut
//  terkirim di pesan ARRIVE:, jadi tidak perlu state tambahan.)

// Akumulator input per sumber (Serial & UDP terpisah agar tidak saling ganggu)
String inputSerial = "";
bool serialReqPos = false;
String inputUdp = "";
bool udpReqPos = false;

enum CmdSource { SRC_NONE, SRC_SERIAL, SRC_UDP };
CmdSource lastSource = SRC_NONE;

// ---------------------------------------------------------------------------
// Respons: kirim ke sumber perintah terakhir (Serial untuk debug, UDP untuk app)
// ---------------------------------------------------------------------------
void respond(const String &s) {
  if (lastSource == SRC_UDP) {
    Udp.beginPacket(Udp.remoteIP(), Udp.remotePort());
    Udp.print(s);
    Udp.endPacket();
  } else {
    Serial.print(s);
  }
}

// ---------------------------------------------------------------------------
// Servis event Serial + UDP (dipanggil dari loop() dan dari dalam loop gerak
// agar E-STOP / heartbeat tetap diproses saat motor sedang bergerak)
// ---------------------------------------------------------------------------
void serviceEvents();

void setup() {
  Serial.begin(9600);
  Ethernet.begin(mac, ip, gateway, subnet);
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("Ethernet shield was not found. Sorry, can't run without hardware. :(");
    while (true) { delay(1); }
  }
  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("Ethernet cable is not connected.");
  }

  Udp.begin(localPort);

  pinMode(stepPin, OUTPUT);
  pinMode(dirPin, OUTPUT);
  pinMode(enaPin, OUTPUT);
  pinMode(readyPin, OUTPUT);
  pinMode(warningPin, OUTPUT);
  pinMode(redPin, OUTPUT);
  digitalWrite(readyPin, HIGH);
  digitalWrite(warningPin, HIGH);
  digitalWrite(redPin, HIGH);
  delay(500);
  digitalWrite(readyPin, LOW);
  digitalWrite(warningPin, LOW);
  digitalWrite(redPin, LOW);
  delay(500);
  digitalWrite(readyPin, HIGH);
  pinMode(limitPin, SENSOR_PIN_MODE);
  pinMode(sensePin, SENSOR_PIN_MODE);
  Serial.println("Motor Ready");
  stepsPerMM = (float)stepsPerRevolution / keliling;

  Serial.print("UDP server at ");
  Serial.println(Ethernet.localIP());
}

float findMod(float a, float b) {
  float mod;
  if (a < 0) mod = -a; else mod = a;
  if (b < 0) b = -b;
  while (mod >= b) mod = mod - b;
  if (a < 0) return -mod;
  return mod;
}

// Sensor penanda meter (A0): mendeteksi motor melewati flag tiap meter di rel
// (pola baca persis seperti A1: INPUT, HIGH = ditekan/di atas flag).
//  - SELALU melaporkan ke log UDP setiap A0 terbaca HIGH (sekali per penekanan),
//    sehingga operator melihat bukti "sensor di titik itu & HIGH" di Log UDP.
//  - Mengembalikan true bila meter flag == target perintah @<mm> (motor harus
//    berhenti di titik yang dicentang operator). Hanya aktif pada gerakan
//    posisi naik/turun setelah kalibrasi (moveTargetMm > 0).
bool checkA0Flag() {
  if (moveTargetMm <= 0) return false;             // bukan gerakan posisi aktif
  if (digitalRead(sensePin) != 1) { a0HighLogged = false; return false; } // belum di atas flag

  float approx = moveStartPosMM +
                 (moveDir == 'U' ? (moveSteps / stepsPerMM) : -(moveSteps / stepsPerMM));
  int flagMeter = (approx > 0) ? (int)((approx + 500.0) / 1000.0)
                               : (int)((approx - 500.0) / 1000.0);
  int targetMeter = (moveTargetMm + 500) / 1000;   // target 6000 -> meter 6

  // Lapor ke UDP: sensor A0 sekarang HIGH di titik itu (sekali per penekanan)
  if (!a0HighLogged) {
    a0HighLogged = true;
    respond("SENSOR:A0_HIGH;FLAG=" + String(flagMeter) + ";POS=" + String((long)approx) +
            ";TGT=" + String(targetMeter));
  }

  // --- ATG-5.0: GERBANG BERHENTI BERBASIS ROTASI (presisi mm) -------------
  // A0 HIGH saja TIDAK lagi cukup menghentikan motor. Hasil lapangan: motor
  // sering berhenti kurang / lebih dari plat, karena versi lama membandingkan
  // METER BULAT (flagMeter >= targetMeter) sehingga toleransinya tersembunyi
  // jadi ±500 mm — untuk target 10 m, A0 baru dianggap "di titik" sejak 9,5 m.
  // Sekarang yang menentukan "sudah di titik" adalah JARAK ROTASI: posisi hasil
  // hitungan langkah step harus sudah sampai dalam jendela STOP_TOLERANCE_MM
  // dari target. A0 HIGH di dalam jendela itu = tiba & terkonfirmasi sensor.
  //
  // Resolusi rotasi 0,012 mm/langkah, jadi jendela 30 mm TAK TERLALU HALUS.
  a0ApproxMM = (long)approx;
  long deltaMm = (long)approx - (long)moveTargetMm;
  long deltaAbs = (deltaMm < 0) ? -deltaMm : deltaMm;
  if (deltaAbs > STOP_TOLERANCE_MM) {
    // A0 menyala jauh dari target — mis. tombol simulasi ditekan di 7,6 m
    // sementara target 10 m. JANGAN berhenti di sini dan jangan dihitung sebagai
    // kedatangan: motor akan terus menelusuri sampai jendela toleransi tercapai
    // (lihat MoveOvershootIfNeeded).
    return false;
  }
  // Jarak rotasi cocok DAN A0 HIGH -> benar-benar tiba di atas plat.
  sensorConfirmed = true;
  return true;
}

// ===========================================================================
// LOOP GERAK (sama dengan Basic_Test.ino, ditambah cek ESTOP + serviceEvents)
// ===========================================================================

// Batas langkah pengaman untuk gerakan kalibrasi HOME/ZERO (≈ 19 m cadangan;
// mencegah motor lari terus bila sensor macet tak pernah kembali LOW).
#define MAX_CALIB_STEPS 1600000UL

// Kalibrasi HOME/ZERO dengan VALIDASI SENSOR NYATA (versi toleran tombol):
//   - Dianggap SAH bila A1 terbaca HIGH SELAGI motor bergerak (tombol simulasi
//     ditekan saat kereta tiba di titik acuan, atau kereta tiba di plat pemicu
//     asli). Push-button terpasang idle LOW / tekan HIGH (sudah diverifikasi),
//     jadi tombol BISA ditekan kapan saja — termasuk menahan dari awal gerak.
//   - Pengaman: bila sensor tidak kunjung terpicu sampai MAX_CALIB_STEPS
//     (~19 m), motor berhenti (E-STOP) dan fungsi mengembalikan false sehingga
//     HOME_DONE/ZERO_DONE tidak dikirim (tombol ZERO tetap terkunci).
bool runCalibUntilDetect(int dirLevel) {
  delayMotors = speedSlow;
  digitalWrite(dirPin, dirLevel);
  unsigned long stepsDone = 0;
  for (;;) {
    if (estopActive) return false;
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(delayMotors);
    if (digitalRead(limitPin) == 1) break; // deteksi nyata saat bergerak
    digitalWrite(stepPin, LOW);
    delayMicroseconds(delayMotors);
    if (digitalRead(limitPin) == 1) break;
    if (++stepsDone > MAX_CALIB_STEPS) { estopActive = true; return false; }
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
  return true; // A1 terpicu selama bergerak (HOME/ZERO sah)
}

bool MoveMaju_Init()   { return runCalibUntilDetect(HIGH); } // HOME: menuju 17 m
bool MoveMundur_Init() { return runCalibUntilDetect(LOW);  } // ZERO: menuju <5 m
bool MoveKiri_Init()   { return runCalibUntilDetect(HIGH); } // READY ('x'): sama dgn HOME

void MoveKiriByRot(int rotation) {
  bool flagInc = true;
  delayMotors = speedSlow;
  digitalWrite(dirPin, HIGH); // HIGH - putar searah jarum jam
  if (rotation > 2) {
    for (int j = 0; j < rotation; j++) {
      if (estopActive || sensorArrived) break;
      if (j == (rotation - 1)) flagInc = false;
      for (int i = 0; i < stepsPerRevolution; i++) {
        if (estopActive || sensorArrived) break;
        if ((i % 30 == 0) && flagInc) delayMotors = delayMotors - 1;
        if ((i % 40 == 0) && !flagInc) delayMotors = delayMotors + 1;
        if (delayMotors < speedFast) delayMotors = speedFast;
        if (delayMotors > speedSlow) delayMotors = speedSlow;
        digitalWrite(stepPin, HIGH);
        digitalWrite(warningPin, HIGH);
        delayMicroseconds(delayMotors);
        digitalWrite(stepPin, LOW);
        digitalWrite(warningPin, LOW);
        delayMicroseconds(delayMotors);
        moveSteps++;
        if (checkA0Flag()) { sensorArrived = true; break; }
        if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
      }
    }
  } else {
    for (int j = 0; j < rotation; j++) {
      if (estopActive || sensorArrived) break;
      for (int i = 0; i < stepsPerRevolution; i++) {
        if (estopActive || sensorArrived) break;
        digitalWrite(stepPin, HIGH);
        digitalWrite(warningPin, HIGH);
        delayMicroseconds(delayMotors);
        digitalWrite(stepPin, LOW);
        digitalWrite(warningPin, LOW);
        delayMicroseconds(delayMotors);
        moveSteps++;
        if (checkA0Flag()) { sensorArrived = true; break; }
        if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
      }
    }
  }
}

void MoveKiriByMM(int pos) {
  int rotation, sisa;
  rotation = pos / keliling;
  if (rotation < 1 || rotation > 2) delayMotors = speedSlow;
  else delayMotors = speedMedium;
  MoveKiriByRot(rotation);
  if (sensorArrived) return; // berhenti karena flag penanda (A0) == target
  sisa = (int)(findMod(pos, keliling) * stepsPerMM);
  delayMotors = speedSlow;
  for (int i = 0; i < sisa; i++) {
    if (estopActive || sensorArrived) break;
    digitalWrite(stepPin, HIGH);
    digitalWrite(warningPin, HIGH);
    delayMicroseconds(delayMotors);
    digitalWrite(stepPin, LOW);
    digitalWrite(warningPin, LOW);
    delayMicroseconds(delayMotors);
    moveSteps++;
    if (checkA0Flag()) { sensorArrived = true; break; }
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
}

void MoveKananByRot(int rotation) {
  bool flagInc = true;
  delayMotors = speedSlow;
  digitalWrite(dirPin, LOW); // LOW - putar berlawanan jarum jam
  if (rotation > 2) {
    for (int j = 0; j < rotation; j++) {
      if (estopActive || sensorArrived) break;
      if (j == (rotation - 1)) flagInc = false;
      for (int i = 0; i < stepsPerRevolution; i++) {
        if (estopActive || sensorArrived) break;
        if ((i % 30 == 0) && flagInc) delayMotors = delayMotors - 1;
        if ((i % 40 == 0) && !flagInc) delayMotors = delayMotors + 1;
        if (delayMotors < speedFast) delayMotors = speedFast;
        if (delayMotors > speedSlow) delayMotors = speedSlow;
        digitalWrite(stepPin, HIGH);
        digitalWrite(warningPin, HIGH);
        delayMicroseconds(delayMotors);
        digitalWrite(stepPin, LOW);
        digitalWrite(warningPin, LOW);
        delayMicroseconds(delayMotors);
        moveSteps++;
        if (checkA0Flag()) { sensorArrived = true; break; }
        if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
      }
    }
  } else {
    for (int j = 0; j < rotation; j++) {
      if (estopActive || sensorArrived) break;
      for (int i = 0; i < stepsPerRevolution; i++) {
        if (estopActive || sensorArrived) break;
        digitalWrite(stepPin, HIGH);
        digitalWrite(warningPin, HIGH);
        delayMicroseconds(delayMotors);
        digitalWrite(stepPin, LOW);
        digitalWrite(warningPin, LOW);
        delayMicroseconds(delayMotors);
        moveSteps++;
        if (checkA0Flag()) { sensorArrived = true; break; }
        if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
      }
    }
  }
}

void MoveKananByMM(int pos) {
  int rotation, sisa;
  rotation = pos / keliling;
  if (rotation < 1 || rotation > 2) delayMotors = speedSlow;
  else delayMotors = speedMedium;
  MoveKananByRot(rotation);
  if (sensorArrived) return; // berhenti karena flag penanda (A0) == target
  sisa = (int)(findMod(pos, keliling) * stepsPerMM);
  delayMotors = speedSlow;
  for (int i = 0; i < sisa; i++) {
    if (estopActive || sensorArrived) break;
    digitalWrite(stepPin, HIGH);
    digitalWrite(warningPin, HIGH);
    delayMicroseconds(delayMotors);
    digitalWrite(stepPin, LOW);
    digitalWrite(warningPin, LOW);
    delayMicroseconds(delayMotors);
    moveSteps++;
    if (checkA0Flag()) { sensorArrived = true; break; }
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
}

// --- ATG-5.0: posisi terkini dari ROTASI (presisi mm) ---------------------
// Satu-satunya sumber kebenaran posisi. Tidak ada pembulatan ke meter bulat,
// sehingga error tidak pernah terakumulasi ke perintah berikutnya.
float currentPosMM() {
  return moveStartPosMM +
         (moveDir == 'U' ? (moveSteps / stepsPerMM) : -(moveSteps / stepsPerMM));
}

// --- ATG-5.0: jaring pengaman bila sensor A0 gagal membaca plat ----------
// Skenario lapangan: motor mencapai jarak target, tapi A0 tidak pernah HIGH
// (plat terlewat / sensor macet). Motor tidak boleh diam di situ lalu diam-diam
// dianggap arrived — motor menelusuri sampai kelebihan STOP_TOLERANCE_MM lalu
// berhenti paksa, dan arrivalState menyatakan bahwa titik ini diambil di luar
// titik agar aplikasi menampilkan popup dengan peringatan.
//
// Arah stepper sudah diset oleh MoveKiriByMM/MoveKananByMM sebelumnya, jadi di
// sini tidak perlu mengatur dirPin lagi: gerak lanjut arah yang sedang berjalan.
void MoveOvershootIfNeeded() {
  if (sensorArrived) return;                 // A0 sudah mengonfirmasi, tak perlu
  if (estopActive) return;
  if (moveTargetMm <= 0) return;

  int steps = (int)((float)STOP_TOLERANCE_MM * stepsPerMM);
  delayMotors = speedSlow;
  for (int i = 0; i < steps; i++) {
    if (estopActive || sensorArrived) break;
    digitalWrite(stepPin, HIGH);
    digitalWrite(warningPin, HIGH);
    delayMicroseconds(delayMotors);
    digitalWrite(stepPin, LOW);
    digitalWrite(warningPin, LOW);
    delayMotors = speedSlow;
    moveSteps++;
    // Kalau A0 menyala saat sudah masuk jendela toleransi, checkA0Flag()
    // mengembalikan true dan sensorConfirmed=true — berhenti sebagai kedatangan
    // yang sah, bukan lewat jaring pengaman.
    if (checkA0Flag()) { sensorArrived = true; break; }
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
}

void UjiKananByMM(int pos) {
  int rotation, sisa;
  rotation = pos / keliling;
  sisa = (int)(findMod(pos, keliling) * stepsPerMM);
  digitalWrite(dirPin, LOW); // LOW - putar berlawanan jarum jam
  delayMotors = speedSlow2;
  for (int i = 0; i < sisa; i++) {
    if (estopActive) break;
    digitalWrite(stepPin, HIGH);
    digitalWrite(warningPin, HIGH);
    delayMicroseconds(delayMotors);
    digitalWrite(stepPin, LOW);
    digitalWrite(warningPin, LOW);
    delayMicroseconds(delayMotors);
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
}

void UjiKiriByMM(int pos) {
  int rotation, sisa;
  rotation = pos / keliling;
  sisa = (int)(findMod(pos, keliling) * stepsPerMM);
  digitalWrite(dirPin, HIGH); // HIGH - putar searah jarum jam
  delayMotors = speedSlow2;
  for (int i = 0; i < sisa; i++) {
    if (estopActive) break;
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(delayMotors);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(delayMotors);
    if ((cmdCounter++ & 0x3F) == 0) serviceEvents();
  }
}

void MoveUkurMaju() {
  delay(1000);
  respond("ACK");
  UjiKananByMM(10);
  delay(1000);
  UjiKiriByMM(10);
  delay(1000);
  respond("UKUR_DONE");
}

void MoveUkurMundur() {
  delay(1000);
  respond("ACK");
  UjiKiriByMM(10);
  delay(1000);
  UjiKananByMM(10);
  delay(1000);
  respond("UKUR_DONE");
}

// ===========================================================================
// PENANGANAN PERINTAH
// ===========================================================================

// Perintah posisi absolut (berasal dari serial '@..\r' atau paket UDP '@..')
void handlePositionValue(int value) {
  if (value == 0) { // @0 = kalibrasi ZERO: ke limit A1 di ujung sebelum 5 m
    if (!homeDone) { respond("NOT_HOMED"); return; }
    if (!MoveMundur_Init()) return;          // terpotong E-STOP sebelum limit
    posisi = ZERO_ORIGIN_MM;                 // bukan 0 — skala-label, lihat define di atas
    zeroDone = true;
    respond("ZERO_DONE");
  } else {
    // Pengunci kalibrasi bertingkat: pergerakan posisi (@<mm>) hanya boleh
    // setelah HOME_DONE (ujung >17 m) lalu ZERO_DONE (ujung <5 m).
    if (!homeDone) { respond("NOT_HOMED"); return; }
    if (!zeroDone) { respond("NOT_ZEROED"); return; }
    moveTargetMm = value;      // aktifkan sensor penanda meter (A0)
    sensorArrived = false;
    // ATG-5.0: reset state vonis kedatangan untuk gerakan ini.
    sensorConfirmed = false;
    a0ApproxMM = -1;
    moveSteps = 0;
    moveStartPosMM = posisi;
    moveDir = (value > posisi) ? 'U' : 'D';
    // Naik (nilai target > posisi) = arah yang sama dengan HOME ('+' / HIGH,
    // menuju 17 m) ✓. Turun = arah ZERO ('-' / LOW, menuju <5 m).
    if (value > posisi) MoveKiriByMM(value - posisi);
    else if (value < posisi) MoveKananByMM(posisi - value);
    else {
      // Sudah berada tepat di posisi target → tanpa gerak. Tetap laporkan
      // kedatangan agar aplikasi membuka popup (operator tetap mengisikan nilai).
      moveTargetMm = -1;
      sensorConfirmed = false;
      respond("ARRIVE:OK;POS=" + String((long)value) + ";TARGET=" + String(value) + ";DELTA=0");
      respond("POS_DONE:" + String(value));
      return;
    }

    // ATG-5.0: jaring pengaman. Kalau A0 tidak pernah mengonfirmasi, motor
    // menelusuri sampai kelebihan STOP_TOLERANCE_MM lalu berhenti di sana.
    // Sisi stepper SUDAH diset oleh MoveKiriByMM/MoveKananByMM, dan moveDir
    // masih 'U'/'D' sehingga hitungan rotasi tetap benar untuk arah ini.
    MoveOvershootIfNeeded();

    // Posisi akhir dari ROTASI (bukan meter bulat). Ini yang jadi acuan
    // perintah berikutnya, jadi error tidak pernah terakumulasi.
    long finalPos = (long)currentPosMM();
    posisi = finalPos;
    long delta = finalPos - (long)value;   // bertanda: + berarti lewat/lewat target

    if (sensorConfirmed) {
      // Kondisi 1 (ideal): jarak rotasi cocok DAN A0 HIGH di atas plat.
      // SENDP=<mm> memberi bukti posisi tepat saat A0 terpicu, jadi operator
      // bisa membandingkannya sendiri dengan POS=<mm> posisi akhir.
      respond("ARRIVE:OK;POS=" + String(finalPos) + ";TARGET=" + String(value) +
              ";DELTA=" + String(delta) + ";SENDP=" + String(a0ApproxMM));
    } else {
      // Kondisi 2: A0 tidak mengonfirmasi (plat terlewat / sensor gagal / tombol
      // ditekan jauh dari target). Motor sudah berhenti di posisi sebenarnya dan
      // popup WAJIB tampil dengan peringatan — operator yang memutuskan mau
      // mengisikan nilai atau melewati titiknya.
      respond("ARRIVE:OFF_POINT;POS=" + String(finalPos) + ";TARGET=" + String(value) +
              ";DELTA=" + String(delta) + ";SENSOR=FAIL");
    }
    // POS_DONE TETAP POLOS ("POS_DONE:<mm>") supaya versi aplikasi lama yang
    // parsing dengan Number(p.substring(9)) tidak jadi NaN dan tidak macet.
    // Aplikasi baru membaca ARRIVE: untuk tahu meleset atau tidak.
    respond("POS_DONE:" + String(value));
  }
}

// Perintah karakter tunggal (sama untuk Serial & UDP)
void handleCommand(char inChar) {
  // Perintah gerak baru secara implisit me-reset E-STOP sebelumnya, sehingga
  // operator bisa langsung meneruskan gerakan setelah menekan E-STOP.
  if (inChar == 'x' || inChar == '+' || inChar == '-' || inChar == '%' || inChar == '#') {
    estopActive = false;
  }
  if (inChar == 'x' || inChar == '+') {
    // HOME: motor ke arah 17 m sampai A1 (plat pemicu di ujung setelah 17 m).
    // Satu-satunya perintah yang boleh pada saat program pertama dinyalakan.
    respond(inChar == 'x' ? "READY" : "MAJU");
    bool reached = (inChar == 'x') ? MoveKiri_Init() : MoveMaju_Init();
    if (!reached) return; // E-STOP memotong sebelum limit → tidak diklaim HOME
    posisi = HOME_ORIGIN_MM;      // aproksimasi posisi di ujung HOME; dikoreksi flag A0
    homeDone = true;
    respond("HOME_DONE");
  } else if (inChar == 'y') {
    respond("OK");
  } else if (inChar == '-') {
    // ZERO: motor mundur sampai A1 (plat pemicu di ujung sebelum 5 m).
    // Butuh HOME_DONE dulu (kalibrasi bertingkat).
    if (!homeDone) { respond("NOT_HOMED"); return; }
    respond("MUNDUR");
    if (!MoveMundur_Init()) return; // E-STOP memotong sebelum limit
    posisi = ZERO_ORIGIN_MM;        // bukan 0 — skala-label, lihat define di atas
    zeroDone = true;
    respond("ZERO_DONE");
  } else if (inChar == '%' || inChar == '#') {
    // Mode ukur juga butuh kalibrasi bertingkat (HOME lalu ZERO).
    if (!homeDone) { respond("NOT_HOMED"); return; }
    if (!zeroDone) { respond("NOT_ZEROED"); return; }
    if (inChar == '%') ukurIsMundur = false;
    if (!ukurIsMundur) { ukurIsMundur = true; MoveUkurMaju(); }
    else { ukurIsMundur = false; MoveUkurMundur(); }
  } else if (inChar == 's') {
    estopActive = true;
    respond("ESTOP");
  }
}

// Jalur Serial (9600 baud) — sama dengan Basic_Test.ino
void serialEvent() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    Serial.println(inChar); // echo (perilaku asli Basic_Test.ino)
    lastSource = SRC_SERIAL;
    if (serialReqPos) {
      if (inChar == '\r') {
        delay(500);
        int value = (int)inputSerial.toInt();
        estopActive = false; // perintah gerak baru me-reset ESTOP
        serialReqPos = false;
        inputSerial = "";
        handlePositionValue(value);
      } else {
        if (inChar != '\n') inputSerial += inChar;
      }
    } else {
      if (inChar == '@') {
        serialReqPos = true;
      } else if (inChar == '\r' || inChar == '\n') {
        // abaikan
      } else {
        handleCommand(inChar);
      }
    }
  }
}

// Jalur UDP (Ethernet shield W5100)
void udpEvent() {
  int packetSize = Udp.parsePacket();
  if (packetSize <= 0) return;
  lastSource = SRC_UDP;
  if (packetSize > (int)sizeof(packetBuffer) - 1) packetSize = sizeof(packetBuffer) - 1;
  int len = Udp.read(packetBuffer, packetSize);
  if (len < 0) return;
  packetBuffer[len] = '\0';

  String packet = String(packetBuffer);
  packet.trim();

  if (packet.length() == 0) return;

  if (packet.startsWith("@")) {
    int value = (int)packet.substring(1).toInt();
    estopActive = false; // perintah gerak baru me-reset ESTOP
    handlePositionValue(value);
  } else {
    for (unsigned int i = 0; i < packet.length(); i++) {
      handleCommand(packet.charAt(i));
    }
  }
}

void serviceEvents() {
  serialEvent();
  udpEvent();
}

void loop() {
  serviceEvents();
}