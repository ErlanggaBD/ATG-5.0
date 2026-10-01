# ATG-FIRMWARE-Arduino

Firmware Arduino untuk **Otomasi Pengujian ATG Horizontal** (rentang 1–17 meter).
File tunggal: `Basic_Test_UDP.ino`.

> Firmware ini adalah **turunan** dari `Basic_Test.ino` asli. File asli **tidak**
> dimodifikasi — semua eksperimen hanya dilakukan di file turunan ini.

Pasangan dengan aplikasi desktop: **ATG-5.0** (folder `ATG-5.0/`).

---

## 0. Ringkasan perubahan ATG-5.0

Pada versi sebelumnya motor berhenti berdasarkan **meter bulat** dari sensor A0
(`flagMeter >= targetMeter`). Meter bulat introducing toleransi tersembunyi
**±500 mm**: untuk target 10 m, A0 baru dianggap "di titik" sejak posisi 9,5 m.
Inilah penyebab motor terlihat berhenti kurang / lebih dari plat di lapangan.

Sekarang **acuan utama adalah jarak ROTASI**, yang dihitung dari jumlah langkah
step (resolusi 0,012 mm/langkah — jauh lebih halus dari toleransi), dan **sensor A0
hanya jadi konfirmasi kedua**. Konsekuensinya:

| Kondisi | Apa yang terjadi | Balasan firmware | Popup aplikasi |
|---|---|---|---|
| **1 — ideal** | Jarak rotasi sudah di dalam toleransi **dan** A0 HIGH di atas plat | `ARRIVE:OK;POS=…;TARGET=…;DELTA=…;SENDP=…` | Normal, tombol Simpan |
| **2 — gagal** | A0 tidak mengonfirmasi (plat terlewat / sensor mati / tekan di luar titik). Motor menelusuri sampai kelebihan toleransi lalu berhenti | `ARRIVE:OFF_POINT;POS=…;TARGET=…;DELTA=…;SENSOR=FAIL` | Peringatan **meleset X cm** + dua pilihan |

Pada kondisi 2 operator **tetap boleh** mengisikan dan menyimpan nilainya, atau
memilih **Lewati Titik** supaya motor lanjut ke titik berikutnya. Setiap pilihan
dicatat di Log UDP dan di CSV.

### Plat yang terlewat di tengah perjalanan

Kalau operator memulai pengujian **di atas** titik 5 m (mis. langsung ke 8 m),
plat 5 m – 7 m **dilewati** di tengah perjalanan. A0 akan menyala saat dilewati,
tetapi motor **tidak berhenti** di sana:

- A0 HIGH yang jaraknya dari target lebih dari `STOP_TOLERANCE_MM` **diabaikan**
  (`checkA0Flag()` mengembalikan `false`).
- **Posisi tidak diubah dan tidak dihitung ulang** — posisi selalu dari hitungan
  rotasi, jadi tidak ada yang perlu disinkronkan.
- Plat yang terlewat tetap **tercatat** di log UDP sebagai
  `SENSOR:A0_HIGH;FLAG=5;POS=…;TGT=8`, berguna untuk diagnosa.

### Geometri rel: posisi memakai SKALA-LABEL, bukan jarak fisik

Semua angka posisi di firmware memakai **skala yang tertulis di rel** (5 m – 17 m),
**bukan** jarak fisik dari ujung rel. Kenyataan di lapangan:

| | Jarak fisik dari limit bawah | Koordinat skala-label |
|---|---|---|
| limit A1 ujung bawah (`ZERO`) | 0 mm | **4700** |
| plat uji pertama (label **5 m**) | 300 mm | 5000 |
| plat uji terakhir (label **17 m**) | 12.300 mm | 17000 |
| limit A1 ujung atas (`HOME`) | 13.000 mm | **17700** |

Jadi panjang rel hanya ±13 m, dan perpindahan antar plat **1000 mm** (seragam,
sesuai labelnya). Konsekuensi yang paling penting:

> Saat motor berada di `ZERO` dan diperintahkan ke titik 5 m, jaraknya
> **300 mm, bukan 5000 mm.**

Karena itu `posisi` diisi `ZERO_ORIGIN_MM` saat `ZERO_DONE`, bukan `0`. Semua
logika stop, toleransi, dan sensor tetap memakai skala-label, jadi **tidak ada
koreksi di dalam fungsi geraknya** — hanya titik awal koordinatnya yang bergeser.

Dua konstanta, di `Basic_Test_UDP.ino`:

```cpp
#define ZERO_ORIGIN_MM 4700   // koordinat skala-label saat di limit bawah
#define HOME_ORIGIN_MM 17700  // koordinat skala-label saat di limit atas
```

**Cara tuning di lapangan:** ukur jarak limit bawah → plat 5 m dengan meteran,
lalu ubah **hanya `ZERO_ORIGIN_MM`** dengan rumus `5000 - jarak_ukur_mm`.
Contoh: kalau hasil ukur 280 mm, jadi `ZERO_ORIGIN_MM 4720`. Tidak ada kode
lain yang perlu disentuh.

> Angka yang sama juga dipakai aplikasi desktop (`ZERO_ORIGIN_METER = 4.7`,
> `HOME_ORIGIN_METER = 17.7` di `src/App.tsx`) **hanya untuk tampilan** — perintah
> `@<mm>` yang dikirim ke firmware tetap `5000`–`17000` apa adanya.

### Menuning toleransi

Satu konstanta saja, di `Basic_Test_UDP.ino`:

```cpp
#define STOP_TOLERANCE_MM 30      // 30 mm = 3,0 cm
```

Ubah **hanya angka itu** lalu compile ulang. Batas wajar 20–50 mm. Nilai ini
sekaligus berfungsi sebagai jendela konfirmasi sensor dan sebagai batas
kelebihan jarak pada kondisi 2.

### Menguji logikanya tanpa board

```bash
bash tools/firmware-test/run.sh
```

Harness ini mengompilasi `Basic_Test_UDP.ino` yang **asli** dengan stub Arduino
dan mensimulasikan dunia fisik (plat tiap meter, drift rotasi, sensor mati,
tombol ditekan di luar titik). Tidak butuh Arduino IDE, motor, atau plat.

Yang diuji termasuk geometri rel: `ZERO` → titik 5 m harus **300 mm**, plat
berdekatan **1000 mm**, `ZERO` → titik 17 m **12.300 mm**, dan plat yang terlewat
di tengah perjalanan **tidak** menghentikan motor.

---

## 1. Peran

- Menggerakkan **motor stepper** pada rel ATG horizontal
- Menyediakan **kalibrasi HOME / ZERO** yang wajib didahulukan
- Menjawab perintah **UDP** dari aplikasi desktop (Ethernet shield W5100, port `8888`)
- Memvalidasi **sensor A1** (HOME/ZERO) dan **sensor A0** (penanda meter di rel)

## 2. Konfigurasi

| Item | Nilai |
|---|---|
| Board | Arduino Nano (compile `arduino:avr:uno`, upload `arduino:avr:nano:cpu=atmega328old`) |
| alamat board di LAN | `192.168.1.103` |
| port UDP | `8888` |
| pin motor | `stepPin = 4`, `dirPin = 5` |
| pin sensor | `limitPin = A1` (HOME/ZERO), `sensePin = A0` (penanda meter) |
| `stepsPerRevolution` | `1600` (sesuaikan SW1–SW3 motor driver) |
| kecepatan | `speedFast 30` · `speedMedium 200` · **`speedSlow 500`** · `speedSlow2 5000` |
| lintasan | `stepsPerMM = 1600 / 19` ≈ 84,2 langkah/mm (1 langkah ≈ 0,012 mm) |
| toleransi stop | `STOP_TOLERANCE_MM = 30` mm (3,0 cm) — konfirmasi sensor + batas kelebihan |
| asal skala | `ZERO_ORIGIN_MM = 4700` · `HOME_ORIGIN_MM = 17700` (lihat "Geometri rel") |

## 3. Protokol UDP (port 8888)

| Perintah | Balasan | Keterangan |
|---|---|---|
| `y` | `OK` | ping / verifikasi koneksi |
| `+` atau `x` | `MAJU`/`READY` … `HOME_DONE` | kalibrasi HOME → posisi `HOME_ORIGIN_MM` (17700) |
| `-` atau `@0` | `MUNDUR` … `ZERO_DONE` | kalibrasi ZERO → posisi `ZERO_ORIGIN_MM` (4700) |
| `@<mm>` | `ARRIVE:…` lalu `POS_DONE:<mm>` | pindah ke posisi absolut (butuh HOME + ZERO) |
| `%` atau `#` | `ACK` … `UKUR_DONE` | toggle mode ukur |
| `s` | `ESTOP` | emergency stop |

Jawaban penolakan: `NOT_HOMED`, `NOT_ZEROED`.

Setiap selesai di satu titik firmware mengirim **dua pesan berurutan**:

```
ARRIVE:OK;POS=9970;TARGET=10000;DELTA=-30;SENDP=9970
POS_DONE:10000
```

atau, bila sensor A0 tidak mengonfirmasi:

```
ARRIVE:OFF_POINT;POS=10029;TARGET=10000;DELTA=29;SENSOR=FAIL
POS_DONE:10000
```

> **`POS_DONE:<mm>` sengaja dibiarkan polos** (hanya berisi angka target) supaya
> aplikasi versi lama yang mem-parse dengan `Number(p.substring(9))` tetap jalan.
> Informasi arrival dikirim lewat pesan `ARRIVE:` yang terpisah.

## 4. Alur kalibrasi bertingkat

1. **Awal program dinyalakan** → hanya HOME (`+`/`x`) yang boleh dijalankan.
   Motor jalan ke ujung atas rel (±13 m) sampai A1 terpicu → `HOME_DONE`
   (posisi 17700).
2. Setelah `HOME_DONE` → ZERO (`-`/`@0`) boleh: motor mundur sampai A1 terpicu
   di ujung bawah → `ZERO_DONE` (posisi 4700). Ingat: angka 4700 **bukan** 0 —
   ini ujung skala-label, 300 mm di belakang plat 5 m.
3. Setelah `ZERO_DONE` → pergerakan posisi (`@<mm>`) dan mode ukur (`%`) boleh jalan.
4. **Setiap upload me-reset board** → HOME dan ZERO wajib diulang.

## 5. Validasi sensor

- **A1 (HOME/ZERO)** dianggap sah **hanya bila benar-benar berubah dari LOW → HIGH
  selagi motor bergerak**. Sensor yang macet HIGH sejak awal (pull-down hilang /
  kabel putus) **tidak** akan memvalidasi — ZERO dan gerakan posisi tetap terkunci.
- **A0 (penanda meter)** jadi **konfirmasi kedua**, bukan penentu berhenti.
  A0 HIGH di dalam jendela `STOP_TOLERANCE_MM` dari target → `ARRIVE:OK` (popup
  normal). A0 HIGH **jauh** dari target (mis. ada tekan di 7,6 m sementara target
  10 m) → **diabaikan**, motor tetap lanjut; tidak ada lagi popup di bukan titik
  uji. A0 tidak pernah HIGH → motor menelusuri sampai kelebihan toleransi lalu
  `ARRIVE:OFF_POINT` supaya operator tahu dan memutuskan.

> **Penting — jenis sensor.** File ini dikompilasi dengan
> `#define SENSOR_BUTTON_PLUS5V` aktif, yaitu **build tombol simulasi** untuk
> development di meja. Unit lapangan memakai sensor proximity dan dikompilasi
> sebagai **`SENSOR_NC_PLATE`**. Keduanya kini memakai gerbang rotasi yang sama,
> jadi logika stop tidak lagi berbeda di antara keduanya.

## 6. Cara compile & upload

```bash
arduino-cli compile --fqbn arduino:avr:uno        Basic_Test_UDP
arduino-cli upload  --fqbn arduino:avr:nano:cpu=atmega328old Basic_Test_UDP
```

Verifikasi setelah upload: kirim `y`, harus dibalas `OK`.

> Tutup **Serial Monitor Arduino IDE** sebelum upload — monitor mengunci
> `/dev/ttyUSB0` sehingga upload gagal dengan "Device or resource busy".

## 7. Batasan yang diketahui

- `#define limitPin A1` (= D2) dan `#define redPin 2` menunjuk **pin yang sama**.
  LED merah yang terpasang di sana bisa menarik A1 HIGH saat diam → `HOME_DONE` palsu.
  **Perbaikannya di sisi kabel, bukan di kode.**
- **Angka 4700/17700 hanya valid kalau geometri di atas benar.** Kalau di
  lapangan jarak limit bawah → plat 5 m ternyata bukan 300 mm, **harus** diukur
  lalu `ZERO_ORIGIN_MM` disesuaikan. Nilai 300 mm berasal dari pengukuran lapangan
  dan belum divalidasi ulang dengan meteran — asumsi yang dipakai firmware, bukan
  hasil pengukuran ulang.
- **Posisi `posisi` sekarang berasal dari rotasi, bukan meter bulat.** Ini
  menghilangkan penumpukan error pembulatan pada perintah berikutnya, tapi berarti
  angka posisi ikut mewarisi **slippage mekanis** ( backlash, keausan rel). Kalau
  di lapangan rotasi menyimpul lebih dari toleransi (default 30 mm) dari posisi
  fisik sebenarnya, A0 tidak akan pernah HIGH di dekat target dan titik akan
  dilaporkan `OFF_POINT` — sistem lebih memilih memberi tahu operator daripada
  diam-diam mengklaim "di titik". Naikkan `STOP_TOLERANCE_MM` bila rel longgar
  atau backlash besar.
- `POS_DONE` tetap melaporkan nilai **target**, bukan posisi fisik. Ini disengaja
  agar angka di aplikasi tetap sinkron dengan titik yang dituju; posisi fisik
  yang sebenarnya ada di field `POS=` pada pesan `ARRIVE:`.
