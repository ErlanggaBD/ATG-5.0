import { describe, it, expect } from 'vitest';
import { parseArriveMessage, formatDeltaCm } from './arrival';

describe('parseArriveMessage', () => {
  it('urai status OK beserta posisi, target, dan selisih', () => {
    const report = parseArriveMessage('ARRIVE:OK;POS=9970;TARGET=10000;DELTA=-30;SENDP=9970');
    expect(report).toEqual({ status: 'OK', posMm: 9970, targetMm: 10000, deltaMm: -30 });
  });

  it('urai status OFF_POINT beserta sensor gagal', () => {
    const report = parseArriveMessage('ARRIVE:OFF_POINT;POS=10029;TARGET=10000;DELTA=29;SENSOR=FAIL');
    expect(report).toEqual({ status: 'OFF_POINT', posMm: 10029, targetMm: 10000, deltaMm: 29 });
  });

  it('toleransi spasi dan newline dari UDP', () => {
    const report = parseArriveMessage('  ARRIVE:OK;POS=10000;TARGET=10000;DELTA=0  \n');
    expect(report?.status).toBe('OK');
    expect(report?.deltaMm).toBe(0);
  });

  it('menolak pesan ARRIVE yang tidak dikenal statusnya, bukan diasumsikan aman', () => {
    expect(parseArriveMessage('ARRIVE:MAYBE;POS=10000;TARGET=10000;DELTA=0')).toBeNull();
    expect(parseArriveMessage('ARRIVE:')).toBeNull();
  });

  it('menolak ARRIVE dengan angka tidak lengkap atau bukan angka', () => {
    expect(parseArriveMessage('ARRIVE:OK;POS=abc;TARGET=10000;DELTA=0')).toBeNull();
    expect(parseArriveMessage('ARRIVE:OK;POS=10000;TARGET=10000')).toBeNull();
    expect(parseArriveMessage('ARRIVE:OFF_POINT;POS=;TARGET=10000;DELTA=0')).toBeNull();
  });

  it('mengabaikan pesan lain dari firmware', () => {
    expect(parseArriveMessage('POS_DONE:10000')).toBeNull();
    expect(parseArriveMessage('SENSOR:A0_HIGH;FLAG=10;POS=9880;TGT=10')).toBeNull();
    expect(parseArriveMessage('HOME_DONE')).toBeNull();
    expect(parseArriveMessage('ACK')).toBeNull();
  });

  it('POS_DONE tetap polos agar parsing versi lama tidak jadi NaN', () => {
    // Bentuk yang dipakai firmware secara literal. Kalau suatu saat digabung
    // jadi satu baris, Number(substring(9)) di versi lama akan jadi NaN.
    const posDone = 'POS_DONE:10000';
    expect(Number(posDone.substring(9))).toBe(10000);
  });
});

describe('formatDeltaCm', () => {
  it('menyebut "meleset" untuk selisih positif', () => {
    expect(formatDeltaCm(29)).toBe('meleset 2.9 cm');
    expect(formatDeltaCm(30)).toBe('meleset 3.0 cm');
  });

  it('menyebut "kurang" untuk selisih negatif', () => {
    expect(formatDeltaCm(-30)).toBe('kurang 3.0 cm');
    expect(formatDeltaCm(-1)).toBe('kurang 0.1 cm');
  });

  it('nol tidak diberi arah', () => {
    expect(formatDeltaCm(0)).toBe('kurang 0.0 cm');
  });
});
