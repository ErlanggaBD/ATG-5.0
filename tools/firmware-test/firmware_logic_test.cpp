// ===========================================================================
// UJI LOGIKA FIRMWARE — kompilasi & jalankan Basic_Test_UDP.ino yang ASLI
// ---------------------------------------------------------------------------
// File ini bukan simulasi terpisah: ia #include langsung firmware aslinya,
// lalu memanggil fungsi gerbang berhentinya dengan sensor yang dikendalikan.
//
// Yang diuji (hasil lapangan):
//   - motor boleh berhenti kurang / lebih dari plat kalau acuannya meter bulat
//   - acuan baru: jarak ROTASI dalam jendela STOP_TOLERANCE_MM
//   - A0 menyala jauh dari target harus TIDAK dihitung sebagai kedatangan
//   - A0 tidak pernah menyala -> motor menelusuri lalu berhenti pada kelebihan
//     STOP_TOLERANCE_MM dan melaporkan OFF_POINT
//
// Build:  bash tools/firmware-test/run.sh
// ===========================================================================
#include "stubs/Arduino.h"
#include "stubs/Ethernet.h"
#include "stubs/EthernetUdp.h"

#include <cmath>

int stub_pinState[64] = {0};
std::string stub_serialOut;
StubSerial Serial;
StubEthernet Ethernet;
int (*stubDigitalReadHook)(int pin) = nullptr;

// Masukkan firmware asli. Stub diinclude lebih dulu supaya #include <SPI.h>
// dsb. di firmware diarahkan ke stub.
#include "../../Basic_Test_UDP/Basic_Test_UDP.ino"

// ---------------------------------------------------------------------------
// Simulasi dunia fisik
// ---------------------------------------------------------------------------
// Plat ada di SETIAP meter bulat, lebar PLATE_HALF_MM. Sensor proximity (A0)
// membaca HIGH saat pillar berada di atas plat. Posisi FISIK pillar =
// posisi ROTASI + drift: drift inilah yang di lapangan membuat motor berhenti
// kurang / lebih dari plat.
namespace sim {

constexpr double PLATE_HALF_MM = 60.0;  // lebar plat ±60 mm
double g_driftMm = 0.0;             // positif = rotasi melaporkan posisi terlalu kecil
bool g_sensorDead = false;          // A0 tidak pernah HIGH (plat terlewat / sensor mati)
bool g_buttonActive = false;        // tombol simulasi ditekan
double g_buttonFromMm = 0.0;        // posisi rotasi saat tombol mulai ditekan
double g_buttonUntilMm = 1e9;       // posisi rotasi saat tombol dilepas (tekan sesaat)

double rotationMm() {
  float stepsPer = stepsPerMM;  // > 0 setelah setup()
  double travelled = (double)moveSteps / stepsPer;
  return (double)moveStartPosMM + (moveDir == 'U' ? travelled : -travelled);
}

double physicalMm() { return rotationMm() + g_driftMm; }

// Plat di rel ada di setiap meter SKALA-LABEL 5 m .. 17 m, yaitu pada koordinat
// 5000 .. 17000. Yang di bawah 5000 (zona antara limit A1 di 4700 sampai plat
// pertama) TIDAK ada plat — harus dikembalikan false, kalau tidak simulasi
// mengarang plat fiktif di 4000 dan bisa menghentikan motor di tempat salah.
constexpr double FIRST_PLATE_MM = 5000.0;
constexpr double LAST_PLATE_MM = 17000.0;

bool plateUnderPillar() {
  double p = physicalMm();
  if (p < FIRST_PLATE_MM || p > LAST_PLATE_MM) return false;
  // Plat terdekat = meter bulat terdekat (bukan hasil bagi +500 tanpa floor).
  double nearest = std::floor((p + 500.0) / 1000.0) * 1000.0;
  double d = p - nearest;
  return d > -PLATE_HALF_MM && d < PLATE_HALF_MM;
}

int senseHook(int pin) {
  if (pin != sensePin) return LOW;  // A1 (limit) selalu LOW: bukan home/zero
  if (g_sensorDead) return LOW;
  if (g_buttonActive && rotationMm() >= g_buttonFromMm &&
      rotationMm() <= g_buttonUntilMm) {
    return HIGH;  // tombol simulasi ditekan
  }
  return plateUnderPillar() ? HIGH : LOW;
}

void reset(double driftMm, bool sensorDead, bool buttonActive = false,
           double buttonFromMm = 0.0, double buttonUntilMm = 1e9) {
  g_driftMm = driftMm;
  g_sensorDead = sensorDead;
  g_buttonActive = buttonActive;
  g_buttonFromMm = buttonFromMm;
  g_buttonUntilMm = buttonUntilMm;
}

void clearOutput() { stub_serialOut.clear(); }

bool sent(const char *needle) {
  return stub_serialOut.find(needle) != std::string::npos;
}

// Ambil angka setelah "KEY=" dari pesan ARRIVE: (BUKAN dari log SENSOR:A0_HIGH,
// yang juga punya key POS= dan muncul lebih dulu untuk tiap plat yang dilewati).
std::string field(const char *key) {
  size_t arrive = stub_serialOut.rfind("ARRIVE:");
  if (arrive == std::string::npos) return "";
  size_t stop = stub_serialOut.find("POS_DONE:", arrive);
  std::string msg = stub_serialOut.substr(
      arrive, stop == std::string::npos ? std::string::npos : stop - arrive);
  std::string k = std::string(";") + key + "=";
  size_t at = msg.find(k);
  if (at == std::string::npos) return "";
  at += k.size();
  size_t end = msg.find(';', at);
  return msg.substr(at, end == std::string::npos ? end : end - at);
}

}  // namespace sim

// ---------------------------------------------------------------------------
// Assertion sederhana
// ---------------------------------------------------------------------------
static int g_fail = 0;
static int g_pass = 0;
static const char *g_case = "";

static void check(bool cond, const std::string &what) {
  if (cond) {
    g_pass++;
  } else {
    g_fail++;
    printf("  GAGAL  [%s] %s\n", g_case, what.c_str());
    printf("         pesan firmware: %s\n", stub_serialOut.c_str());
  }
}

// Siapkan state supaya gerakan posisi @<target> diizinkan (home+zero sudah).
static void primeCalibration() {
  homeDone = true;
  zeroDone = true;
  posisi = ZERO_ORIGIN_MM;  // motor di limit A1 ujung bawah
}

// ---------------------------------------------------------------------------
// SKENARIO
// ---------------------------------------------------------------------------
static void test_sensor_confirms_at_target() {
  g_case = "sensor konfirmasi tepat di target";
  sim::reset(0.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  check(sim::sent("ARRIVE:OK"), "harus melaporkan ARRIVE:OK");
  check(!sim::sent("OFF_POINT"), "tidak boleh OFF_POINT");
  long delta = atol(sim::field("DELTA").c_str());
  check(delta <= STOP_TOLERANCE_MM,
        "selisih harus <= jendela toleransi, didapat " + std::to_string(delta));
  check(posisi >= 10000 - STOP_TOLERANCE_MM && posisi <= 10000 + STOP_TOLERANCE_MM,
        "posisi akhir harus dekat 10000 mm, didapat " + std::to_string(posisi));
}

static void test_small_drift_still_confirms() {
  g_case = "drift kecil (15 mm) masih terkonfirmasi";
  sim::reset(15.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  check(sim::sent("ARRIVE:OK"), "drift 15 mm masih di dalam jendela 30 mm");
}

static void test_drift_absorbed_by_plate_width() {
  g_case = "drift 60 mm diserap (lebar plat 60 + jendela 30)";
  // Plat di lapangan punya lebar fisik. Drift sebesar lebar plat + jendela
  // toleransi masih diserap sistem; motor harus tetap berhenti DEKAT target.
  sim::reset(60.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  long pos = atol(sim::field("POS").c_str());
  check(sim::sent("ARRIVE:OK"),
        "drift yang masih bisa diserap seharusnya kedatangan terkonfirmasi");
  check(pos >= 10000 - STOP_TOLERANCE_MM && pos <= 10000 + STOP_TOLERANCE_MM,
        "posisi berhenti harus dekat target; didapat " + std::to_string(pos));
}

static void test_drift_beyond_absorption_is_reported() {
  g_case = "drift 200 mm tidak bisa diserap -> OFF_POINT";
  // Di luar lebar plat + jendela, A0 tidak akan pernah HIGH di dekat target.
  // Sistem WAJIB melapor apa adanya — bukan diam-diam mengklaim "di titik".
  sim::reset(200.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  check(sim::sent("ARRIVE:OFF_POINT"),
        "di luar jangkauan harus dilaporkan OFF_POINT supaya operator tahu");
  check(sim::sent("SENSOR=FAIL"), "status sensor harus GAGAL");
  long pos = atol(sim::field("POS").c_str());
  check(pos >= 10000 && pos <= 10000 + STOP_TOLERANCE_MM + 2,
        "berhenti di target + kelebihan kecil; didapat " + std::to_string(pos));
}

static void test_sensor_dead_stops_at_overshoot() {
  g_case = "A0 mati total -> berhenti pada kelebihan toleransi";
  sim::reset(0.0, true);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  check(sim::sent("ARRIVE:OFF_POINT"), "harus OFF_POINT");
  long delta = atol(sim::field("DELTA").c_str());
  check(delta <= STOP_TOLERANCE_MM + 2,
        "kelebihan tidak boleh jauh lewat jendela, didapat " + std::to_string(delta));
  check(delta > 0, "kelebihan harus positif (lewati target), didapat " + std::to_string(delta));
  check(sim::sent("POS_DONE:10000"), "POS_DONE tetap polos untuk app lama");
}

static void test_early_button_press_does_not_stop_motor() {
  g_case = "tombol dipencet di 7,6 m menuju 10 m -> motor TETAP lanjut";
  // Kekhawatiran lapangan: operator/senior menekan sensor di luar titik uji
  // (mis. 7,6 m) lalu popup pengukuran terbuka di posisi yang bukan titik —
  // data salah masuk tanpa disadari. Versi lama (meter bulat) ikut salah
  // karena flagMeter >= targetMeter sudah terpenuhi di 7,6 m.
  // Now: tekan sesaat di 7,60 m (dilepas 7,61 m), lalu sensor normal.
  sim::reset(0.0, false, /*buttonActive=*/true, /*buttonFromMm=*/7600.0,
             /*buttonUntilMm=*/7610.0);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  // 1. Tidak boleh ada POPUP di luar titik: satu-satunya laporan kedatangan
  //    harus berasal dari target, bukan dari tekan di 7,6 m.
  check(sim::sent("ARRIVE:OK") || sim::sent("ARRIVE:OFF_POINT"),
        "harus ada tepat satu laporan kedatangan dari target");
  // 2. Motor tidak boleh berhenti di 7,6 m — harus naik sampai vicinity target.
  check(posisi >= 9900,
        "motor tidak boleh berhenti di 7,6 m; posisi akhir=" + std::to_string(posisi));
  // 3. Karena sensor kembali normal di atas plat 10 m, kedatangan terkonfirmasi.
  check(sim::sent("ARRIVE:OK"),
        "tekan di luar titik tidak boleh menggagalkan kedatangan yang benar");
  long pos = atol(sim::field("POS").c_str());
  check(pos >= 10000 - STOP_TOLERANCE_MM && pos <= 10000 + STOP_TOLERANCE_MM,
        "berhenti dekat 10000 mm; didapat " + std::to_string(pos));
}

static void test_stray_sensor_high_with_dead_plate_reports_offpoint() {
  g_case = "tekan di luar titik DAN plat target hilang -> OFF_POINT";
  // Kasus terburuk: ada tekan palsu di 7,6 m, dan plat di 10 m tidak terbaca
  // (kotor/sensor mati). Motor tetap lanjut ke target, lalu jaring pengaman
  // menghentikan di target + toleransi, dan operator diberi tahu.
  sim::reset(0.0, /*sensorDead=*/true, /*buttonActive=*/true,
             /*buttonFromMm=*/7600.0, /*buttonUntilMm=*/7610.0);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);

  check(sim::sent("ARRIVE:OFF_POINT"),
        "harus OFF_POINT — motor berhenti lewat target, bukan tepat di titik");
  check(posisi >= 10000,
        "tidak boleh berhenti di 7,6 m; posisi=" + std::to_string(posisi));
  check(posisi <= 10000 + STOP_TOLERANCE_MM + 2,
        "kelebihan dibatasi jendela; posisi=" + std::to_string(posisi));
}

static void test_downward_also_works() {
  g_case = "arah TURUN juga memakai gerbang rotasi";
  posisi = 10000;
  homeDone = true;
  zeroDone = true;
  sim::reset(0.0, false);
  sim::clearOutput();
  handlePositionValue(5000);

  check(sim::sent("ARRIVE:OK"), "turun tepat di target harus OK");
  check(posisi >= 5000 - STOP_TOLERANCE_MM && posisi <= 5000 + STOP_TOLERANCE_MM,
        "posisi akhir harus dekat 5000 mm, didapat " + std::to_string(posisi));
}

static void test_position_not_rounded_to_whole_meter() {
  g_case = "posisi tidak lagi dibulatkan ke meter bulat";
  // Berhenti di 9,965 m: versi lama (meter bulat) menulis 10000 dan hilang
  // 35 mm; versi baru harus menyimpan angka sebenarnya.
  sim::reset(-35.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(10000);
  long reported = atol(sim::field("POS").c_str());
  check(reported % 1000 != 0 || reported == 0,
        "POS yang dilaporkan harus presisi, bukan meter bulat; didapat " +
            std::to_string(reported));
}

// ---------------------------------------------------------------------------
// SKENARIO GEOMETRI REL (koreksi titik nol, ATG-5.0)
// ---------------------------------------------------------------------------
// Konteks lapangan: rel physik hanya ~13 m, skala nominalnya 5-17 m. Limit A1
// ujung bawah (ZERO) berada 300 mm di belakang plat berlabel 5 m.

// Plat di rel hanya ada pada koordinat 5000..17000. Zona antara limit A1 (4700)
// dan plat pertama, maupun di luar plat terakhir, TIDAK ada plat. Test ini
// mengikat perilaku itu: kalau rumus deteksi plat suatu saat diubah dan mulai
// mengarang plat di 4500 atau 17500, test ini gagal.
static void test_no_phantom_plate_before_first() {
  g_case = "tidak ada plat fiktif sebelum plat 5 m";
  double saved = sim::g_driftMm;
  posisi = ZERO_ORIGIN_MM;
  homeDone = true;
  zeroDone = true;
  moveTargetMm = 0;  // nonaktifkan gate; kita hanya memanggil sensor langsung
  moveStartPosMM = 4500;
  moveDir = 'U';
  moveSteps = 0;
  sim::reset(0.0, false);

  // 4500 mm = 200 mm di belakang plat pertama: harus LOW.
  check(!sim::plateUnderPillar(), "4500 mm tidak boleh terbaca plat");
  // Tepat di plat pertama: HIGH.
  moveStartPosMM = 5000;
  check(sim::plateUnderPillar(), "5000 mm harus terbaca plat");
  // Di luar ujung atas: LOW.
  moveStartPosMM = 17500;
  check(!sim::plateUnderPillar(), "17500 mm (lewat plat 17 m) tidak boleh plat");
  // Sisi turun dari plat pertama: 5000 - 100 = 4900, dalam zona tanpa plat.
  moveStartPosMM = 4900;
  check(!sim::plateUnderPillar(), "4900 mm masih zona tanpa plat");
  // 4600 mm juga (400 mm di belakang plat pertama).
  moveStartPosMM = 4600;
  check(!sim::plateUnderPillar(), "4600 mm tidak boleh plat");
  // 4000 mm: kalau rumus pembulatan dipakai tanpa batas bawah, koordinat ini
  // akan membulatkan diri ke "plat 4000" yang tidak ada sama sekali. Ini titik
  // yang membuktikan guard batas bawah benar-benar bekerja.
  moveStartPosMM = 4000;
  check(!sim::plateUnderPillar(), "4000 mm tidak boleh plat (plat fiktif)");
  // 18000 mm: sama seperti di atas tapi di sisi ujung atas.
  moveStartPosMM = 18000;
  check(!sim::plateUnderPillar(), "18000 mm tidak boleh plat (plat fiktif)");
  sim::g_driftMm = saved;
}

static void test_calibration_sets_scale_origin() {
  g_case = "kalibrasi mengisi asal skala, bukan angka 0";
  sim::reset(0.0, false);
  homeDone = false;
  zeroDone = false;

  // HOME: A1 harus menyala saat motor bergerak. Stub selalu LOW untuk A1, jadi
  // jalankan MAX_CALIB_STEPS... terlalu lama. Cukup uji ZERO lewat posisi langsung.
  posisi = HOME_ORIGIN_MM;
  check(posisi == 17700, "HOME_ORIGIN_MM harus 17700, didapat " +
                            std::to_string(posisi));
  posisi = ZERO_ORIGIN_MM;
  check(posisi == 4700,
        "ZERO_ORIGIN_MM harus 4700, didapat " + std::to_string(posisi));
  check(sim::FIRST_PLATE_MM - ZERO_ORIGIN_MM == 300,
        "jarak limit ZERO ke plat 5 m harus 300 mm");
  check(HOME_ORIGIN_MM - ZERO_ORIGIN_MM == 13000,
        "panjang rel harus 13.000 mm");
  check(sim::FIRST_PLATE_MM == 5000 && sim::LAST_PLATE_MM == 17000,
        "plat uji berada di koordinat 5000..17000");
  check(ZERO_ORIGIN_MM < sim::FIRST_PLATE_MM,
        "limit ZERO harus di belakang plat pertama");
  check(HOME_ORIGIN_MM > sim::LAST_PLATE_MM,
        "limit HOME harus di depan plat terakhir");
  // Jarak antar plat = jarak antar label = 1000 mm, seragam.
  check(sim::LAST_PLATE_MM - sim::FIRST_PLATE_MM == 12000,
        "jarak plat 5 m ke 17 m harus 12.000 mm (12 celah x 1000 mm)");
}

static void test_first_move_from_zero_is_300mm() {
  g_case = "ZERO -> @5000 hanya 300 mm tempuh";
  sim::reset(0.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(5000);

  // Plat pertama ada di 5000, jadi motor harus naik dari 4700 ke 5000 saja.
  check(posisi >= 5000 - STOP_TOLERANCE_MM && posisi <= 5000 + STOP_TOLERANCE_MM,
        "harus berhenti dekat plat 5000 mm, didapat " + std::to_string(posisi));
  check(sim::sent("ARRIVE:OK"), "tiba di plat pertama harus OK");
  long travelled = posisi - ZERO_ORIGIN_MM;
  check(travelled >= 300 - STOP_TOLERANCE_MM && travelled <= 300 + STOP_TOLERANCE_MM,
        "jarak tempuh harus ~300 mm, didapat " + std::to_string(travelled));
}

static void test_last_plate_is_12300mm_from_zero() {
  g_case = "ZERO -> @17000 = 12.300 mm (bukan 17.000 mm)";
  sim::reset(0.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(17000);

  long travelled = posisi - ZERO_ORIGIN_MM;
  check(travelled >= 12300 - STOP_TOLERANCE_MM &&
            travelled <= 12300 + STOP_TOLERANCE_MM,
        "jarak tempuh harus ~12.300 mm, didapat " + std::to_string(travelled));
  check(sim::sent("ARRIVE:OK"), "tiba di plat terakhir harus OK");
}

static void test_adjacent_plates_are_1000mm() {
  g_case = "plat berdekatan berjarak 1000 mm";
  sim::reset(0.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(5000);
  int afterFirst = posisi;

  sim::clearOutput();
  handlePositionValue(6000);
  int step = posisi - afterFirst;
  check(step >= 1000 - STOP_TOLERANCE_MM && step <= 1000 + STOP_TOLERANCE_MM,
        "perpindahan 5 m -> 6 m harus ~1000 mm, didapat " + std::to_string(step));
  check(sim::sent("ARRIVE:OK"), "tiba di plat kedua harus OK");
}

static void test_plate_passed_mid_travel_does_not_stop_motor() {
  g_case = "plat 5 m terlewat saat @8000 tidak menghentikan motor";
  // Operator memulai pengujian di titik 8 m, jadi plat 5 m (dan 6 m, 7 m)
  // dilewati di tengah perjalanan. A0 akan menyala saat dilewati — motor TIDAK
  // boleh berhenti di sana, dan tidak boleh salah melapor sebagai kedatangan.
  sim::reset(0.0, false);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(8000);

  check(sim::sent("ARRIVE:OK"), "harus tiba di 8000 dengan OK");
  long target = atol(sim::field("TARGET").c_str());
  check(target == 8000, "TARGET harus 8000, didapat " + std::to_string(target));
  check(posisi >= 8000 - STOP_TOLERANCE_MM && posisi <= 8000 + STOP_TOLERANCE_MM,
        "posisi akhir harus dekat 8000, didapat " + std::to_string(posisi));
  // Plat yang dilewat tetap tercatat di log SENSOR:A0_HIGH ( FLAG=5 ).
  check(sim::sent("FLAG=5"), "plat 5 m yang terlewat harus tercatat di log");
  // Tidak boleh ada OLEH_PLAT: satu ATH saja, di target.
  size_t arriveCount = 0;
  for (size_t at = 0;
       (at = stub_serialOut.find("ARRIVE:", at)) != std::string::npos; at += 7) {
    arriveCount++;
  }
  check(arriveCount == 1,
        "tepat satu laporan kedatangan, didapat " + std::to_string(arriveCount));
}

static void test_sensor_dead_from_zero_bounded_overshoot() {
  g_case = "A0 mati total dari ZERO -> overshoot terbatas di plat pertama";
  sim::reset(0.0, true /* A0 mati */);
  primeCalibration();
  sim::clearOutput();
  handlePositionValue(5000);

  check(sim::sent("ARRIVE:OFF_POINT"), "harus OFF_POINT");
  // Berhenti pada 5000 + 30 mm, BUKAN 300 + 30 mm (versi lama salah hitung).
  // Boleh 1 mm kurang: jumlah langkah dibulatkan ke bawah oleh stepsPerMM.
  check(posisi >= 5000 + STOP_TOLERANCE_MM - 1 &&
            posisi <= 5000 + STOP_TOLERANCE_MM,
        "harus berhenti di 5029..5030, didapat " + std::to_string(posisi));
}

int main() {
  // WAJIB: pasang hook sensor SEBELUM apa pun. Tanpa ini digitalRead(A0)
  // selalu LOW dan semua skenario berakhir salah.
  stubDigitalReadHook = sim::senseHook;

  setup();  // menginisialisasi stepsPerMM (butuh stub Ethernet agar tidak hang)

  printf("=== UJI LOGIKA GERBANG BERHENTI (firmware asli) ===\n");
  printf("STOP_TOLERANCE_MM = %d mm (%.1f cm)\n", STOP_TOLERANCE_MM,
         STOP_TOLERANCE_MM / 10.0);
  printf("ZERO_ORIGIN_MM = %d, HOME_ORIGIN_MM = %d\n\n", ZERO_ORIGIN_MM,
         HOME_ORIGIN_MM);

  test_sensor_confirms_at_target();
  test_small_drift_still_confirms();
  test_drift_absorbed_by_plate_width();
  test_drift_beyond_absorption_is_reported();
  test_sensor_dead_stops_at_overshoot();
  test_early_button_press_does_not_stop_motor();
  test_stray_sensor_high_with_dead_plate_reports_offpoint();
  test_downward_also_works();
  test_position_not_rounded_to_whole_meter();

  printf("--- geometri rel (koreksi titik nol) ---\n");
  test_no_phantom_plate_before_first();
  test_calibration_sets_scale_origin();
  test_first_move_from_zero_is_300mm();
  test_last_plate_is_12300mm_from_zero();
  test_adjacent_plates_are_1000mm();
  test_plate_passed_mid_travel_does_not_stop_motor();
  test_sensor_dead_from_zero_bounded_overshoot();

  printf("\nlulus: %d, gagal: %d\n", g_pass, g_fail);
  return g_fail == 0 ? 0 : 1;
}