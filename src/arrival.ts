/**
 * Pemilih status kedatangan motor — ATG-5.0
 *
 * Firmware mengirim dua pesan berurutan setiap kali motor berhenti di satu titik:
 *
 *   ARRIVE:OK;POS=<mm>;TARGET=<mm>;DELTA=<mm>;SENDP=<mm>      (Kondisi 1)
 *   ARRIVE:OFF_POINT;POS=<mm>;TARGET=<mm>;DELTA=<mm>;SENSOR=FAIL   (Kondisi 2)
 *   POS_DONE:<mm>
 *
 * `ARRIVE:` berdiri sendiri dan TIDAK boleh disambung ke `POS_DONE:` — aplikasi
 * versi lama mem-parse POS_DONE dengan `Number(p.substring(9))` dan akan dapat
 * NaN kalau formatnya berubah.
 *
 * Makna kedua kondisi:
 *   OK         → jarak ROTASI sudah di dalam toleransi DAN sensor A0 HIGH di
 *                atas plat. Titik ini aman, popup biasa.
 *   OFF_POINT  → acuan rotasi sudah tercapai tetapi sensor A0 tidak mengonfirmasi
 *                (plat terlewat, sensor mati, atau ada tekan di luar titik).
 *                Motor sudah berhenti pada posisi sebenarnya, yang bisa sedikit
 *                MELESET dari target. Popup WAJIB tampil dengan peringatan dan
 *                operator yang memutuskan: isi nilai atau lewati titik.
 */
export type ArrivalStatus = 'OK' | 'OFF_POINT';

export interface ArrivalReport {
  status: ArrivalStatus;
  /** Posisi pillar saat berhenti, hasil hitungan rotasi (mm). */
  posMm: number;
  /** Posisi titik uji yang dituju (mm). */
  targetMm: number;
  /** posMm - targetMm, bertanda. Positif = motor meleset melewati target. */
  deltaMm: number;
}

const ARRIVE_PREFIX = 'ARRIVE:';

/**
 * Urai pesan ARRIVE: firmware. Mengembalikan null kalau pesannya bukan ARRIVE:
 * atau angkanya tidak lengkap — pemanggil lalu memperlakukan kedatangan sebagai
 * tidak terkonfirmasi, bukan menebak.
 */
export function parseArriveMessage(raw: string): ArrivalReport | null {
  const text = String(raw).trim();
  if (!text.startsWith(ARRIVE_PREFIX)) return null;

  const parts = text.slice(ARRIVE_PREFIX.length).split(';');
  const head = parts[0] ?? '';

  let status: ArrivalStatus | null = null;
  if (head === 'OK') status = 'OK';
  else if (head === 'OFF_POINT') status = 'OFF_POINT';
  if (status === null) return null; // status tidak dikenal -> jangan diasumsikan aman

  const num = (key: string): number => {
    const prefix = `${key}=`;
    const hit = parts.slice(1).find((segment) => segment.startsWith(prefix));
    if (hit === undefined) return NaN;
    const raw = hit.slice(prefix.length).trim();
    // Number('') bernilai 0 dan lolos uji isFinite — jadi string kosong harus
    // ditolak eksplisit, kalau tidak "POS=" salah-terbaca sebagai 0 mm.
    if (raw === '') return NaN;
    return Number(raw);
  };

  const posMm = num('POS');
  const targetMm = num('TARGET');
  const deltaMm = num('DELTA');

  if (!Number.isFinite(posMm) || !Number.isFinite(targetMm) || !Number.isFinite(deltaMm)) {
    return null;
  }

  return { status, posMm, targetMm, deltaMm };
}

/** Selisih dalam cm, dibulatkan 1 desimal, untuk ditampilkan ke operator. */
export function formatDeltaCm(deltaMm: number): string {
  const cm = Math.abs(deltaMm) / 10;
  const text = cm.toFixed(1);
  return deltaMm > 0 ? `meleset ${text} cm` : `kurang ${text} cm`;
}
