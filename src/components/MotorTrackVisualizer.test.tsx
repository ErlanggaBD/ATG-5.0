import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MotorTrackVisualizer } from './MotorTrackVisualizer';
import { MotorStatus } from '../types';

// ATG-5.0: rel fisik ~13 m, skala-label 5-17 m. Limit bawah (ZERO) di 4,7 m
// (300 mm di belakang plat 5 m), limit atas (HOME) di 17,7 m (0,7 m di
// belakang plat 17 m). Visualizer harus menggambar area 4,7 .. 17,7 dengan
// 13 plat uji di 5..17 — bukan 13 tick yang mulai dari limit bawah.
const baseStatus: MotorStatus = {
  isMoving: false,
  currentPositionMeter: 4.7,
  targetPositionMeter: 4.7,
  speedMmPerSec: 0,
  zeroSensorActive: false,
  homeSensorActive: false,
  isTesting: false,
  testingDirection: null,
  testingIndex: 0,
  testingTotal: 0,
} as unknown as MotorStatus;

const renderTrack = (over: Partial<MotorStatus> = {}, onMove = vi.fn()) => {
  const props = { motorStatus: { ...baseStatus, ...over } as MotorStatus, onMoveToMeter: onMove };
  const utils = render(<MotorTrackVisualizer {...props} positionKnown />);
  return { ...utils, onMove };
};

// Posisi kiri dalam persen = jarak absolut di dalam rel.
const leftOf = (el: Element) => parseFloat((el as HTMLElement).style.left);

// Cari teks di dalam container hasil render (bukan document.body global).
const q = (c: HTMLElement, text: string) => {
  const found = Array.from(c.querySelectorAll('*')).filter(
    (el) => el.children.length === 0 && el.textContent === text
  );
  if (found.length !== 1) {
    throw new Error(`harus ada tepat 1 elemen dengan teks "${text}", ada ${found.length}`);
  }
  return found[0];
};

describe('MotorTrackVisualizer — geometri rel ATG-5.0', () => {
  it('menggambar tepat 13 plat uji di 5..17 m', () => {
    const { container } = renderTrack();
    // Pakai container.querySelector, bukan getAllByRole: query peran aksesibel
    // memindai accessibility tree penuh dan mudah menembus batas 5 detik.
    const ticks = Array.from(container.querySelectorAll('[id^="track-tick-"]'));
    expect(ticks).toHaveLength(13);
    expect(ticks[0].id).toBe('track-tick-5');
    expect(ticks[12].id).toBe('track-tick-17');
    // Label tick harus angka meter yang sesuai dengan id-nya.
    expect(ticks.map((t) => t.textContent)).toEqual(
      Array.from({ length: 13 }, (_, i) => String(5 + i))
    );
    // Tidak boleh ada tick di luar rentang plat uji (mis. 4 atau 18).
    expect(container.querySelector('#track-tick-4')).toBeNull();
    expect(container.querySelector('#track-tick-18')).toBeNull();
  });

  it('label batas menyebut limit 4.7 m & 17.7 m, bukan titik uji', () => {
    const { container } = renderTrack();
    const texts = Array.from(container.querySelectorAll('*')).map((e) => e.textContent);
    // Teks lama "5.0m (ZERO)" pernah menyesatkan: itu plat uji pertama, bukan
    // posisi limit. Sekarang batas rel ditulis sebagai 4,7 m & 17,7 m.
    expect(texts).not.toContain('5.0m (ZERO)');
    expect(texts).toContain('4.7m (ZERO)');
    expect(texts).toContain('17.7m (HOME)');
  });

  it('limit bawah berada di kiri plat 5 m, limit atas di kanan plat 17 m', () => {
    const { container } = renderTrack();
    const zero = leftOf(q(container, 'ZERO').parentElement as HTMLElement);
    const home = leftOf(q(container, 'HOME').parentElement as HTMLElement);
    const firstPlate = leftOf(container.querySelector('#track-tick-5') as HTMLElement);
    const lastPlate = leftOf(container.querySelector('#track-tick-17') as HTMLElement);

    expect(zero).toBeLessThan(firstPlate);
    expect(home).toBeGreaterThan(lastPlate);
    // Jarak limit bawah -> plat pertama hanya 300 mm dari 13.000 mm rel, yaitu
    // ~2,1% dari lebar 90%. Kalau offset hilang, jaraknya jadi 0%.
    expect(firstPlate - zero).toBeCloseTo((300 / 13000) * 90, 1);
    // Jarak plat terakhir -> limit atas 700 mm -> ~4,8%.
    expect(home - lastPlate).toBeCloseTo((700 / 13000) * 90, 1);
  });

  it('jarak antar plat seragam: 12 celah sama besar', () => {
    const { container } = renderTrack();
    const pcts = Array.from({ length: 13 }, (_, i) =>
      leftOf(container.querySelector(`#track-tick-${5 + i}`) as HTMLElement)
    );
    const gaps = pcts.slice(1).map((p, i) => p - pcts[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 5);
    // Setiap celah 1.000 mm pada rel 13.000 mm yang memakai 90% lebar.
    expect(gaps[0]).toBeCloseTo((1000 / 13000) * 90, 5);
  });

  it('klik plat meneruskan meter apa adanya (skala-label, tanpa offset)', () => {
    const { container, onMove } = renderTrack();
    fireEvent.click(container.querySelector('#track-tick-5') as HTMLButtonElement);
    fireEvent.click(container.querySelector('#track-tick-17') as HTMLButtonElement);
    // Aplikasi & firmware sudah sama-sama memakai skala-label; offset hanya
    // untuk tampilan, jadi angka yang dikirim TIDAK boleh dikurangi 4,7 m.
    expect(onMove).toHaveBeenNthCalledWith(1, 5);
    expect(onMove).toHaveBeenNthCalledWith(2, 17);
  });

  it('posisi 4.7 m (di limit bawah) digambar di garis ZERO', () => {
    const { container } = renderTrack({ currentPositionMeter: 4.7 });
    const label = container.querySelector('#lbl-motor-posisi') as HTMLElement;
    expect(label.textContent).toContain('4.700m');
    expect(leftOf(label.parentElement as HTMLElement)).toBe(
      leftOf(q(container, 'ZERO').parentElement as HTMLElement)
    );
  });

  it('posisi 5.0 m (plat pertama) digambar di plat 5, bukan di limit', () => {
    const { container } = renderTrack({ currentPositionMeter: 5.0 });
    const label = container.querySelector('#lbl-motor-posisi') as HTMLElement;
    expect(leftOf(label.parentElement as HTMLElement)).toBeCloseTo(
      leftOf(container.querySelector('#track-tick-5') as HTMLElement),
      5
    );
  });

  it('posisi 17.0 m (plat terakhir) dan 17.7 m (limit atas) berbeda', () => {
    const at = (m: number) => {
      const { container, unmount } = renderTrack({ currentPositionMeter: m });
      const p = leftOf(
        (container.querySelector('#lbl-motor-posisi') as HTMLElement)
          .parentElement as HTMLElement
      );
      const plate = leftOf(container.querySelector('#track-tick-17') as HTMLElement);
      unmount();
      return { marker: p, lastPlate: plate };
    };
    const atPlate = at(17.0);
    // Di 17,0 m marker harus tepat di plat terakhir.
    expect(atPlate.marker).toBeCloseTo(atPlate.lastPlate, 5);
    // Parkir di limit atas harus di kanan plat 17, bukan tepat di platnya.
    const atLimit = at(17.7);
    expect(atLimit.marker).toBeGreaterThan(atPlate.marker);
  });
});
