import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import App from './App';

// Bridge desktopApp hanya tersedia di dalam Electron. Di lingkungan test kita
// install mock agar alur connect/disconnect dan pengiriman paket bisa diuji.
// `emitRx` dipakai tes untuk mensimulasikan balasan firmware (RX) asli,
// misalnya POS_DONE:<mm> / HOME_DONE — sekuens menunggu balasan inilah.
let emitRx: (payload: string) => void = () => {};

function installDesktopBridge() {
  Object.defineProperty(window, 'desktopApp', {
    configurable: true,
    value: {
      isDesktop: true,
      close: vi.fn(),
      loadLastCalibration: vi.fn(async () => null),
      saveLastCalibration: vi.fn(() => true),
      connectHardware: vi.fn(async () => ({ ok: true, connected: true, message: 'ok' })),
      disconnectHardware: vi.fn(async () => ({ ok: true, connected: false, message: 'ok' })),
      sendHardware: vi.fn(async () => ({ ok: true, message: 'sent' })),
      onHardwareLog: vi.fn((cb: (log: { direction: 'TX' | 'RX' | 'SYS'; payload: string; status: 'OK' | 'ERR' | 'INFO' }) => void) => {
        emitRx = (payload: string) => cb({ direction: 'RX', payload, status: 'OK' });
        return () => {};
      }),
      onHardwareState: vi.fn(() => () => {})
    }
  });
}

const connectViaHeader = async () => {
  fireEvent.click(document.getElementById('btn-toggle-tcp') as HTMLButtonElement);
  await act(async () => {});
};

// ===== KOREKSI SENIOR: posisi pilar hanya ditampilkan setelah sensor A1 =====
// Dua elemen yang dipakai assertions (lihat MotorTrackVisualizer.tsx):
//   #lbl-motor-posisi            → chip "MOTOR: <posisi> m" (hanya saat posisinya diketahui)
//   #lbl-posisi-belum-diketahui  → chip "Mencari sensor …"/"Posisi belum diketahui"
const posisiPilar = () => document.getElementById('lbl-motor-posisi')?.textContent ?? null;
const posisiBelumDiketahui = () => document.getElementById('lbl-posisi-belum-diketahui')?.textContent ?? null;

describe('App (smoke test)', () => {
  it('aplikasi boot tanpa error dan menampilkan menu + tabel dengan checkbox', { timeout: 15000 }, () => {
    render(<App />);
    // Mode KALIBRASI aktif di awal
    expect(screen.getByText('1. KALIBRASI')).toBeTruthy();
    // Kolom header tabel yang diharapkan (versi dengan kolom Uji/Check)
    expect(screen.getByText('Uji')).toBeTruthy();
    expect(screen.getByText('Std Naik')).toBeTruthy();
    expect(screen.getByText('Std Turun')).toBeTruthy();
    expect(screen.getByText('Naik (mm)')).toBeTruthy();
    expect(screen.getByText('Turun (mm)')).toBeTruthy();
    // Checkbox titik uji tersedia
    expect(screen.queryAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.getByText(/Pilih Semua Titik/)).toBeTruthy();
  });
});

describe('App — proteksi saat belum terhubung ke hardware', () => {
  beforeEach(() => {
    installDesktopBridge();
  });

  afterEach(() => {
    cleanup();
  });

  it('memblokir aksi perintah hardware saat offline dan menampilkan popup peringatan', () => {
    render(<App />);

    // Klik PENGUJIAN NAIK saat belum terhubung → sekuens TIDAK berjalan, muncul popup
    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);
    expect(screen.getByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeTruthy();
    expect(screen.queryByText(/Sekuens Motor Sedang Berjalan/)).toBeNull();

    // Tutup popup
    fireEvent.click(document.getElementById('btn-connection-close') as HTMLButtonElement);
    expect(screen.queryByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeNull();
  });

  it('menampilkan popup saat ZERO/HOME/klik titik track/E-STOP ditekan dalam keadaan offline', () => {
    render(<App />);

    const expectBlocked = () => {
      expect(screen.getByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeTruthy();
      fireEvent.click(document.getElementById('btn-connection-close') as HTMLButtonElement);
      expect(screen.queryByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeNull();
    };

    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    expectBlocked();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    expectBlocked();

    fireEvent.click(document.getElementById('track-tick-6') as HTMLButtonElement);
    expectBlocked();

    fireEvent.click(document.getElementById('btn-emergency-stop') as HTMLButtonElement);
    expectBlocked();
  });

  it('saat sudah terhubung, kalibrasi bertingkat (HOME lalu ZERO) baru pergerakan bisa berjalan tanpa popup', async () => {
    render(<App />);
    await connectViaHeader();

    // Terhubung → host:port tampil di header & status bar
    expect(screen.getAllByText(/192\.168\.1\.103:8888/).length).toBeGreaterThan(0);

    // Sebelum HOME: tombol ZERO/PENGUJIAN non-aktif, klik tidak
    // memunculkan popup koneksi (aplikasi non-aktifkan sampai HOME_DONE).
    expect((document.getElementById('btn-toolbar-zero') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    expect(screen.queryByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeNull();

    // Klik titik track sebelum kalibrasi → peringatan "belum dikalibrasi"
    fireEvent.click(document.getElementById('track-tick-6') as HTMLButtonElement);
    expect(screen.getByText(/MOTOR BELUM DIKALIBRASI/)).toBeTruthy();
    fireEvent.click(document.getElementById('btn-calibration-close') as HTMLButtonElement);
    expect(screen.queryByText(/MOTOR BELUM DIKALIBRASI/)).toBeNull();

    // HOME tetap aktif: kalibrasi tanpa popup koneksi
    expect((document.getElementById('btn-toolbar-home') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    expect(screen.queryByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeNull();

    // Firmware membalas HOME_DONE → ZERO aktif, PENGUJIAN masih non-aktif
    await act(async () => {
      emitRx('HOME_DONE');
    });
    expect((document.getElementById('btn-toolbar-zero') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(true);

    // ZERO sekarang bisa dijalankan tanpa popup koneksi
    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    expect(screen.queryByText(/BELUM TERHUBUNG KE HARDWARE/)).toBeNull();

    // Firmware membalas ZERO_DONE → PENGUJIAN ikut aktif
    await act(async () => {
      emitRx('ZERO_DONE');
    });
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-toolbar-uji-turun') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('App — auto-reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installDesktopBridge();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('menyambung otomatis setelah koneksi putus tanpa perlu klik manual', async () => {
    render(<App />);
    // Awal: belum terhubung
    expect((document.getElementById('btn-toggle-tcp') as HTMLButtonElement).textContent).toContain('DISCONNECTED');

    // Tunggu 5 detik → auto-reconnect mencoba dan berhasil
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {});

    expect((document.getElementById('btn-toggle-tcp') as HTMLButtonElement).textContent).toContain('192.168.1.103:8888');
    expect(screen.getAllByText(/192\.168\.1\.103:8888/).length).toBeGreaterThan(0);
  });

  it('tidak auto-reconnect setelah diputus secara manual', async () => {
    render(<App />);

    // Hubungkan manual → sudah terhubung
    fireEvent.click(document.getElementById('btn-toggle-tcp') as HTMLButtonElement);
    await act(async () => {});
    expect((document.getElementById('btn-toggle-tcp') as HTMLButtonElement).textContent).toContain('192.168.1.103:8888');

    // Putus manual
    fireEvent.click(document.getElementById('btn-toggle-tcp') as HTMLButtonElement);
    await act(async () => {});
    expect((document.getElementById('btn-toggle-tcp') as HTMLButtonElement).textContent).toContain('DISCONNECTED');

    // Setelah 5 detik, tetap tidak tersambung (diputus manual = jangan auto-konek)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {});
    expect((document.getElementById('btn-toggle-tcp') as HTMLButtonElement).textContent).toContain('DISCONNECTED');
  });

  it('mode KALIBRASI: semua titik otomatis tercentang saat dipilih', async () => {
    render(<App />);

    // Kondisi awal: seluruh 13 titik tercentang
    expect((document.getElementById('chk-point-5') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('chk-point-17') as HTMLInputElement).checked).toBe(true);

    // Pindah ke TERA_ULANG → semua titik dikosongkan
    fireEvent.click(document.getElementById('btn-menu-tera-ulang') as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });
    expect((document.getElementById('chk-point-5') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('chk-point-17') as HTMLInputElement).checked).toBe(false);

    // Kembali ke KALIBRASI → semua titik harus tercentang lagi otomatis
    fireEvent.click(document.getElementById('btn-menu-kalibrasi') as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });
    for (let meter = 5; meter <= 17; meter++) {
      expect((document.getElementById(`chk-point-${meter}`) as HTMLInputElement).checked).toBe(true);
    }
  });

  it('mode KALIBRASI: operator tetap boleh men-uncheck sebagian titik', async () => {
    render(<App />);

    //boleh diubah manual, tapi muncul peringatan karena kurang dari 13 titik
    fireEvent.click(document.getElementById('chk-point-17') as HTMLInputElement);
    await act(async () => {
      await Promise.resolve();
    });
    expect((document.getElementById('chk-point-17') as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById('warn-kalibrasi-belum-lengkap')).not.toBeNull();
  });
});

describe('App — pengujian hanya mengunjungi titik yang dicentang', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installDesktopBridge();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('PENGUJIAN NAIK menunggu POS_DONE asli dari firmware di tiap titik (berhenti fisik)', { timeout: 30000 }, async () => {
    render(<App />);

    // Hubungkan ke hardware terlebih dahulu (syarat sebelum sekuens berjalan)
    await connectViaHeader();

    // Matikan titik 15, 16, 17 → hanya 5..14 yang aktif (10 titik).
    // Catatan: di mode KALIBRASI operator tetap boleh men-uncheck sebagian titik
    // (hanya saat MEMILIH mode KALIBRASI semua titik yang otomatis tercentang).
    // Skenario 10 dari 13 titik ini tidak mungkin di TERA_ULANG karena mode itu
    // membatasi maksimal 5 titik aktif.
    fireEvent.click(document.getElementById('chk-point-15') as HTMLInputElement);
    fireEvent.click(document.getElementById('chk-point-16') as HTMLInputElement);
    fireEvent.click(document.getElementById('chk-point-17') as HTMLInputElement);

    // Hanya 5..14 yang tetap tercentang
    expect((document.getElementById('chk-point-5') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('chk-point-14') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('chk-point-15') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('chk-point-17') as HTMLInputElement).checked).toBe(false);

    // Sebelum kalibrasi, tombol PENGUJIAN non-aktif (syarat wajib HOME dulu)
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(true);

    // Kalibrasi bertingkat: HOME dulu (HOME_DONE), lalu ZERO (ZERO_DONE).
    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });
    // Setelah HOME barulah ZERO aktif; PENGUJIAN masih non-aktif.
    expect((document.getElementById('btn-toolbar-zero') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    await act(async () => {
      emitRx('ZERO_DONE');
    });
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(false);

    // Mulai PENGUJIAN NAIK
    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);
    expect(screen.getByText(/Sekuens Motor Sedang Berjalan/)).toBeTruthy();

    const visitedMeters: number[] = [];

    // Motor bergerak fisik ke tiap titik. Popup HANYA muncul setelah firmware
    // membalas POS_DONE:<mm> — tanda motor benar-benar berhenti (sensor A0
    // penanda meter / posisi target), bukan hasil simulasi animasi lokal.
    for (let step = 0; step < 10; step++) {
      const meter = 5 + step;
      await act(async () => {
        emitRx(`POS_DONE:${meter * 1000}`);
        vi.advanceTimersByTime(0);
      });

      const modal = document.getElementById('modal-measurement') as HTMLElement;
      expect(modal).not.toBeNull();
      const match = modal.textContent?.match(/Titik\s+(\d+)\s+m\s*[—-]\s*Uji Naik/);
      expect(match).not.toBeNull();
      visitedMeters.push(Number(match?.[1]));

      // Isi nilai lalu Simpan
      fireEvent.change(document.getElementById('input-measurement-value') as HTMLInputElement, {
        target: { value: (Number(match?.[1]) * 1000).toString() }
      });
      await act(async () => {
        fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
      });
    }

    // Urutan titik yang dikunjungi harus 5,6,7,...,14
    expect(visitedMeters).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    // Pastikan tidak ada titik > 14 yang dikunjungi
    expect(Math.max(...visitedMeters)).toBeLessThanOrEqual(14);

    // Majukan waktu lebih jauh untuk memastikan motor tidak lanjut ke 15/16/17
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.getElementById('modal-measurement')).toBeNull();

    // Sequence selesai → status siap kembali
    expect(screen.queryByText(/Sekuens Motor Sedang Berjalan/)).toBeNull();
    expect(screen.getByText(/Controller Siap Menerima Perintah UDP/)).toBeTruthy();

    // Motor berhenti di 14m (dikonfirmasi POS_DONE:14000), bukan di home/17m
    expect(screen.getByText(/14\.000m/)).toBeTruthy();
  });
});

// ===== ATG-5.0: KETIKAN KEDUA — acuan rotasi + sensor A0 =====
// Firmware mengirim dua pesan berurutan tiap kali motor berhenti di satu titik:
//   ARRIVE:OK        → jarak rotasi cocok DAN sensor A0 HIGH di atas plat
//   ARRIVE:OFF_POINT → acuan rotasi tercapai tapi A0 tidak mengonfirmasi, jadi
//                      motor berhenti meleset dari target
//   POS_DONE:<mm>    → penanda berhenti fisik (sama seperti sebelumnya)
//
// Yang diuji di sini: popup hanya muncul setelah POS_DONE (bukan saat ARRIVE),
// dan status OFF_POINT mengubah isi popup menjadi peringatan dua pilihan.
describe('App — kedatangan di luar titik (ARRIVE:OFF_POINT)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installDesktopBridge();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Bawa aplikasi ke kondisi siap: terhubung, sudah HOME, sudah ZERO, dan hanya
  // titik 5 + 6 yang dicentang supaya skrip bisa memeriksa dua langkah.
  const reachReadyState = async () => {
    render(<App />);
    await connectViaHeader();
    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });
    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    await act(async () => {
      emitRx('ZERO_DONE');
    });
    for (let m = 7; m <= 17; m++) {
      fireEvent.click(document.getElementById(`chk-point-${m}`) as HTMLInputElement);
    }
  };

  it('ARRIVE:OK tidak memunculkan peringatan meleset', async () => {
    await reachReadyState();

    // Batasi ke titik 5 saja supaya sekuens berhenti setelah satu langkah.
    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    await act(async () => {
      emitRx('ARRIVE:OK;POS=9970;TARGET=5000;DELTA=-30;SENDP=9970');
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });

    const modal = document.getElementById('modal-measurement') as HTMLElement;
    expect(modal).not.toBeNull();
    expect(document.getElementById('lbl-measurement-offpoint')).toBeNull();
    expect(document.getElementById('btn-measurement-skip')).toBeNull();
    // Label tombol tetap seperti semula saat kedatangan terkonfirmasi.
    expect((document.getElementById('btn-measurement-save') as HTMLButtonElement).textContent)
      .toContain('Simpan');
  });

  it('ARRIVE:OFF_POINT memunculkan peringatan dan pilihan Lewati Titik', async () => {
    await reachReadyState();

    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    // Motor berhenti 2,9 cm MELEWATI target 5 m (sensor A0 tidak mengonfirmasi).
    await act(async () => {
      emitRx('ARRIVE:OFF_POINT;POS=5029;TARGET=5000;DELTA=29;SENSOR=FAIL');
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });

    const banner = document.getElementById('lbl-measurement-offpoint');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('meleset 2.9 cm');
    expect(document.getElementById('btn-measurement-skip')).not.toBeNull();
    expect((document.getElementById('btn-measurement-save') as HTMLButtonElement).textContent)
      .toContain('Isi Nilai & Simpan');
  });

  it('popup tetap dibuka meski hanya ada POS_DONE tanpa ARRIVE (firmware lama)', async () => {
    // Kompatibilitas: firmware yang belum mengirim ARRIVE: harus tetap berfungsi
    // persis seperti sebelumnya — popup normal, tanpa peringatan mengada-ada.
    await reachReadyState();

    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    await act(async () => {
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });

    expect(document.getElementById('modal-measurement')).not.toBeNull();
    expect(document.getElementById('lbl-measurement-offpoint')).toBeNull();
  });

  it('melewati titik TIDAK menyimpan nilai, dan motor lanjut ke titik berikutnya', async () => {
    await reachReadyState();

    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    // Titik 5 meleset → operator memilih Lewati Titik.
    await act(async () => {
      emitRx('ARRIVE:OFF_POINT;POS=5029;TARGET=5000;DELTA=29;SENSOR=FAIL');
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });
    fireEvent.change(document.getElementById('input-measurement-value') as HTMLInputElement, {
      target: { value: '5000' }
    });
    await act(async () => {
      fireEvent.click(document.getElementById('btn-measurement-skip') as HTMLButtonElement);
    });

    // Nilai yang diketik TIDAK boleh ikut tersimpan di tabel. Mode awal adalah
    // KALIBRASI, jadi applySequenceMeasurement menulis ke kolom Std Naik — yang
    // ditampilkan lewat input "ALG DISK SEBELUM" pada baris titik 5. Nilai
    // awal baris adalah "0", jadi setelah "Lewati Titik" harus tetap "0".
    const stdNaik5 = document.getElementById('input-alg-disk-sblm-5') as HTMLInputElement;
    expect(stdNaik5.value.trim()).toBe('0');

    // Motor harus lanjut ke titik 6, membuka popup lagi untuk titik tersebut.
    await act(async () => {
      emitRx('ARRIVE:OK;POS=5970;TARGET=6000;DELTA=-30;SENDP=5970');
      emitRx('POS_DONE:6000');
      vi.advanceTimersByTime(0);
    });
    const modal = document.getElementById('modal-measurement') as HTMLElement;
    expect(modal).not.toBeNull();
    expect(modal.textContent).toMatch(/Titik\s+6\s+m/);
  });

  it('nilai tetap bisa diisi dan disimpan saat motor meleset (pilihan operator)', async () => {
    await reachReadyState();

    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    await act(async () => {
      emitRx('ARRIVE:OFF_POINT;POS=4970;TARGET=5000;DELTA=-30;SENSOR=FAIL');
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });
    expect(document.getElementById('lbl-measurement-offpoint')?.textContent).toContain('kurang 3.0 cm');

    fireEvent.change(document.getElementById('input-measurement-value') as HTMLInputElement, {
      target: { value: '5000.000' }
    });
    await act(async () => {
      fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
    });

    // Nilai TIDAK boleh hilang — operator tetap boleh mencatatnya. Mode awal
    // KALIBRASI → nilai ditulis ke kolom Std Naik (input "ALG DISK SEBELUM").
    const stdNaik5 = document.getElementById('input-alg-disk-sblm-5') as HTMLInputElement;
    expect(stdNaik5.value.trim()).toBe('5000');
  });

  it('status meleset titik sebelumnya TIDAK bocor ke popup titik berikutnya', async () => {
    // Kalau motor berhenti tanpa ARRIVE: (mis. E-STOP di tengah jalan), popup
    // titik berikutnya harus normal — bukan menampilkan meleset dari titik lalu.
    await reachReadyState();

    fireEvent.click(document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement);

    await act(async () => {
      emitRx('ARRIVE:OFF_POINT;POS=5029;TARGET=5000;DELTA=29;SENSOR=FAIL');
      emitRx('POS_DONE:5000');
      vi.advanceTimersByTime(0);
    });
    fireEvent.click(document.getElementById('btn-measurement-skip') as HTMLButtonElement);

    // Titik 6: firmware hanya mengirim POS_DONE, tanpa ARRIVE:.
    await act(async () => {
      emitRx('POS_DONE:6000');
      vi.advanceTimersByTime(0);
    });
    expect(document.getElementById('modal-measurement')).not.toBeNull();
    expect(document.getElementById('lbl-measurement-offpoint')).toBeNull();
  });
});

// ===== KOREKSI SENIOR: POSISI PILAR TIDAK DIASUMSI =====
// Saat aplikasi pertama kali dibuka posisi pilar tidak diketahui, sehingga saat
// operator menekan HOME (atau ZERO) tidak boleh ada animasi maupun angka posisi.
// Posisi pilar baru ditampilkan setelah firmware benar-benar melaporkan sensor
// A1 terpicu (HOME_DONE → 17,7 m di ujung rel, ZERO_DONE → 4,7 m).
describe('App — koreksi senior: posisi pillar hanya tampil setelah sensor A1', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installDesktopBridge();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('saat baru dibuka, posisi pillar belum diketahui dan tidak ada angka posisi', async () => {
    render(<App />);
    await connectViaHeader();

    // Tidak ada chip posisi sama sekali…
    expect(posisiPilar()).toBeNull();
    // …dan yang tampil adalah keterangan bahwa posisinya belum diketahui.
    expect(posisiBelumDiketahui()).toContain('Posisi pillar belum diketahui');
  });

  it('saat HOME ditekan: tidak ada animasi posisi, hanya teks "Mencari sensor HOME…"', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {});

    // Pilar disembunyikan + angka posisi tidak muncul.
    expect(posisiPilar()).toBeNull();
    expect(posisiBelumDiketahui()).toContain('Mencari sensor HOME…');
    // Tombol terkunci & berlabel "Mencari sensor…" (perintah '+' tidak dobel).
    expect((document.getElementById('btn-toolbar-home') as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById('btn-toolbar-home')?.textContent).toContain('Mencari sensor');
    // Chip status toolbar jujur: sedang mencari sensor.
    expect(document.getElementById('lbl-mencari-sensor')?.textContent).toContain('Mencari sensor HOME…');
    // Status bar juga jujur: SEARCHING, bukan MOVING dengan angka posisi.
    expect(screen.getByText(/SEARCHING HOME \(posisi \?\)/)).toBeTruthy();

    // SIMULASI HARUS MATI: majukan waktu jauh — posisi tidak boleh "bergerak"
    // sendiri dari angka 0,000 m menuju 17 m.
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(posisiPilar()).toBeNull();
    expect(screen.queryByText(/17\.000m/)).toBeNull();
  });

  it('setelah HOME_DONE (sensor A1 ujung 17 m) posisi pillar muncul di ujung rel', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });

    // Baru sekarang posisi parkir HOME 17.700 m ditampilkan (13,0 m rel fisik
    // + offset 4.700 mm skala-label), dan pencarian selesai.
    expect(posisiPilar()).toContain('MOTOR: 17.700m');
    expect(posisiBelumDiketahui()).toBeNull();
    // Tombol HOME normal lagi; tombol ZERO terbuka; PENGUJIAN masih terkunci.
    expect((document.getElementById('btn-toolbar-home') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('btn-toolbar-home')?.textContent).toContain('HOME (17m)');
    expect((document.getElementById('btn-toolbar-zero') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(true);
    // Indikator limit A1 ujung atas menyala.
    expect(screen.getByText('Limit Atas (Home)').className).toContain('text-emerald-400');
  });

  it('saat ZERO ditekan posisi juga disembunyikan, lalu muncul di 4,7 m setelah ZERO_DONE', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });
    expect(posisiPilar()).toContain('MOTOR: 17.700m');

    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    await act(async () => {});
    //ENCARI sensor ZERO → posisi tidak boleh ditampilkan (pillar 17,700 m
    // tidak boleh "bergerak" sendiri menuju 4,700 m).
    expect(posisiPilar()).toBeNull();
    expect(posisiBelumDiketahui()).toContain('Mencari sensor ZERO…');

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(posisiPilar()).toBeNull();

    await act(async () => {
      emitRx('ZERO_DONE');
    });
    // Firmware membalas ZERO_DONE pada koordinat skala-label 4700 → posisi
    // tampil di 4,7 m (bukan 0), sesuai marker "Limit Bawah (Zero)" di rel.
    expect(posisiPilar()).toContain('MOTOR: 4.700m');
    // Indikator Limit Bawah harus menyala — ini yang mengunci ambang sensor
    // agar tidak lagi memakai angka era lama (5.0).
    expect(screen.getByText('Limit Bawah (Zero)').className).toContain('text-amber-400');
    expect((document.getElementById('btn-toolbar-uji-naik') as HTMLButtonElement).disabled).toBe(false);
    expect((document.getElementById('btn-toolbar-uji-turun') as HTMLButtonElement).disabled).toBe(false);
  });

  // ===== KUNCI GEOMETRI: ambang indikator limit =====
  // Plat uji berada DI ANTARA dua limit A1: plat 5 m berdiri 300 mm di depan
  // limit bawah (4,7 m), plat 17 m berdiri 700 mm di belakang limit atas
  // (17,7 m). Jadi saat pilar sedang di salah satu plat, indikator limit
  // yang PALING DEKAT harus padam.
  //
  // Kode lama menyalakan keduanya di plat (Math.abs(pos - 5.0) < 0.1 dan
  // pos >= 16.9), jadi test ini gagal pada kode lama dan lulus pada kode baru.
  it('di plat 5 m dan plat 17 m indikator limit terdekat harus padam', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });
    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    await act(async () => {
      emitRx('ZERO_DONE');
    });

    // --- Gerak naik ke plat 5 m (300 mm di depan limit bawah) ---
    await act(async () => {
      fireEvent.click(document.querySelector('#track-tick-5') as HTMLButtonElement);
    });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(posisiPilar()).toContain('MOTOR: 5.000m');
    expect(screen.getByText('Limit Bawah (Zero)').className).not.toContain('text-amber-400');
    expect(screen.getByText('Limit Atas (Home)').className).not.toContain('text-emerald-400');

    // --- Gerak naik lagi ke plat 17 m (700 mm di belakang limit atas) ---
    await act(async () => {
      fireEvent.click(document.querySelector('#track-tick-17') as HTMLButtonElement);
    });
    await act(async () => {
      // 12 m / 0,075 m per langkah = 160 interval x 250 ms = 40.000 ms.
      // Diberi kelonggaran supayaPast di target.
      vi.advanceTimersByTime(60000);
    });
    expect(posisiPilar()).toContain('MOTOR: 17.000m');
    // 17 m bukan limit atas (17,7 m) → indikator harus padam.
    expect(screen.getByText('Limit Atas (Home)').className).not.toContain('text-emerald-400');
  });

  it('E-STOP saat mencari sensor mengembalikan tampilan ke posisi terakhir yang diketahui', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {
      emitRx('HOME_DONE');
    });
    expect(posisiPilar()).toContain('MOTOR: 17.700m');

    fireEvent.click(document.getElementById('btn-toolbar-zero') as HTMLButtonElement);
    await act(async () => {});
    expect(posisiBelumDiketahui()).toContain('Mencari sensor ZERO');

    fireEvent.click(document.getElementById('btn-emergency-stop') as HTMLButtonElement);
    await act(async () => {});

    // Tidak nyangkut di "Mencari sensor…" — kembali ke posisi terakhir (17 m).
    expect(posisiBelumDiketahui()).toBeNull();
    expect(posisiPilar()).toContain('MOTOR: 17.700m');
  });

  it('firmware menolak (NOT_HOMED) → berhenti menampilkan "Mencari sensor…"', async () => {
    render(<App />);
    await connectViaHeader();

    fireEvent.click(document.getElementById('btn-toolbar-home') as HTMLButtonElement);
    await act(async () => {});
    expect(posisiBelumDiketahui()).toContain('Mencari sensor HOME');

    await act(async () => {
      emitRx('NOT_HOMED');
    });
    expect(posisiPilar()).toBeNull();
    // Kembali ke keterangan "belum diketahui" (bukan "mencari sensor").
    expect(posisiBelumDiketahui()).toContain('Posisi pillar belum diketahui');
    fireEvent.click(document.getElementById('btn-calibration-close') as HTMLButtonElement);
  });
});
