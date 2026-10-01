import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeasurementModal } from './MeasurementModal';

const baseProps = {
  meter: 5,
  direction: 'UP' as const,
  isCalibration: false,
  isOpen: true,
  onClose: () => {},
  onConfirm: () => {},
};

describe('MeasurementModal', () => {
  it('tidak dirender saat tertutup', () => {
    render(<MeasurementModal {...baseProps} isOpen={false} />);
    expect(screen.queryByText('INPUT HASIL PENGUJIAN')).toBeNull();
  });

  it('menampilkan titik dan arah uji', () => {
    render(<MeasurementModal {...baseProps} meter={7} direction="DOWN" />);
    expect(screen.getByText('INPUT HASIL PENGUJIAN')).toBeTruthy();
    expect(screen.getByText(/Titik 7 m/)).toBeTruthy();
    expect(screen.getByText(/Uji Turun/)).toBeTruthy();
  });

  it('label kalibrasi tampil saat mode KALIBRASI', () => {
    render(<MeasurementModal {...baseProps} isCalibration={true} />);
    expect(screen.getByText(/nilai standar kalibrasi/)).toBeTruthy();
  });

  it('menolak input non-angka dan menampilkan error', () => {
    render(<MeasurementModal {...baseProps} onConfirm={() => {}} />);
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
    expect(screen.getByText('Nilai harus berupa angka.')).toBeTruthy();
  });

  it('menyimpan nilai valid lewat onConfirm', () => {
    const onConfirm = vi.fn();
    render(<MeasurementModal {...baseProps} onConfirm={onConfirm} />);
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000.000' } });
    fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledWith(5000);
  });

  it('Enter menyimpan nilai, Escape membatalkan', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<MeasurementModal {...baseProps} onConfirm={onConfirm} onClose={onClose} />);
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith(12.5);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Titik di LUAR TITIK UJI (firmware: ARRIVE:OFF_POINT — sensor A0 tidak
  // mengonfirmasi). Operator tetap boleh mengisikan nilai, atau melewati titik.
  // ---------------------------------------------------------------------
  const offPoint = { status: 'OFF_POINT' as const, posMm: 10029, targetMm: 10000, deltaMm: 29 };

  it('tidak menampilkan peringatan saat kedatangan normal', () => {
    render(<MeasurementModal {...baseProps} offPoint={null} onSkip={() => {}} />);
    expect(document.getElementById('lbl-measurement-offpoint')).toBeNull();
    expect(document.getElementById('btn-measurement-skip')).toBeNull();
    // Perilaku lama harus utuh: dua tombol, label "Simpan".
    expect(screen.getByText('Simpan')).toBeTruthy();
    expect(screen.getByText('Batal')).toBeTruthy();
  });

  it('tidak menampilkan peringatan kalau offPoint tidak diberikan sama sekali', () => {
    render(<MeasurementModal {...baseProps} onSkip={() => {}} />);
    expect(document.getElementById('lbl-measurement-offpoint')).toBeNull();
    expect(screen.getByText('Simpan')).toBeTruthy();
  });

  it('menampilkan peringatan meleset beserta angka selisih dan posisi', () => {
    render(<MeasurementModal {...baseProps} meter={10} offPoint={offPoint} onSkip={() => {}} />);
    const banner = document.getElementById('lbl-measurement-offpoint');
    expect(banner).not.toBeNull();
    expect(screen.getByText(/MOTOR BERHENTI DI LUAR TITIK UJI/)).toBeTruthy();
    expect(screen.getByText('meleset 2.9 cm')).toBeTruthy();
    expect(screen.getByText(/10000 mm/)).toBeTruthy();
    expect(screen.getByText(/10029 mm/)).toBeTruthy();
  });

  it('menyebut "kurang" saat motor berhenti sebelum target', () => {
    render(
      <MeasurementModal
        {...baseProps}
        offPoint={{ status: 'OFF_POINT', posMm: 9970, targetMm: 10000, deltaMm: -30 }}
        onSkip={() => {}}
      />
    );
    expect(screen.getByText('kurang 3.0 cm')).toBeTruthy();
  });

  it('menawarkan tepat dua pilihan: Isi Nilai & Simpan, dan Lewati Titik', () => {
    render(<MeasurementModal {...baseProps} offPoint={offPoint} onSkip={() => {}} />);
    // Nama tombol dicari lewat tombolnya supaya tidak bentrok dengan kalimat
    // penjelas di banner peringatan yang juga menyebut nama aksi tersebut.
    const saveBtn = document.getElementById('btn-measurement-save') as HTMLButtonElement;
    const skipBtn = document.getElementById('btn-measurement-skip') as HTMLButtonElement;
    expect(saveBtn.textContent).toContain('Isi Nilai & Simpan');
    expect(skipBtn.textContent).toContain('Lewati Titik');
    expect(screen.getAllByText('Lewati Titik').length).toBeGreaterThan(0);
    // "Batal" disembunyikan: di mode ini pilnya sama dengan Lewati Titik, jadi
    // tidak boleh ada pintasan ketiga yang ambigu.
    expect(screen.queryByText('Batal')).toBeNull();
  });

  it('tetap menyimpan nilai saat operator memilih Isi Nilai & Simpan', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <MeasurementModal {...baseProps} meter={10} offPoint={offPoint} onConfirm={onConfirm} onSkip={onSkip} />
    );
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000.000' } });
    fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledWith(5000);
    // Memilih simpan TIDAK boleh sekaligus melewati titik.
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('melewati titik tanpa menyimpan nilai saat operator memilih Lewati Titik', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <MeasurementModal {...baseProps} meter={10} offPoint={offPoint} onConfirm={onConfirm} onSkip={onSkip} />
    );
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000.000' } });
    fireEvent.click(document.getElementById('btn-measurement-skip') as HTMLButtonElement);
    expect(onSkip).toHaveBeenCalledTimes(1);
    // Nilai yang diketik harus dibuang, bukan ikut tersimpan diam-diam.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape pada titik meleset berarti Lewati Titik, bukan batal diam-diam', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    const onClose = vi.fn();
    render(
      <MeasurementModal
        {...baseProps}
        offPoint={offPoint}
        onConfirm={onConfirm}
        onSkip={onSkip}
        onClose={onClose}
      />
    );
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000.000' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Enter pada titik meleset tetap menyimpan, bukan melewati', () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <MeasurementModal {...baseProps} offPoint={offPoint} onConfirm={onConfirm} onSkip={onSkip} />
    );
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith(42.5);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('validasi angka tetap berlaku di titik meleset', () => {
    const onConfirm = vi.fn();
    render(<MeasurementModal {...baseProps} offPoint={offPoint} onConfirm={onConfirm} onSkip={() => {}} />);
    const input = document.getElementById('input-measurement-value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(document.getElementById('btn-measurement-save') as HTMLButtonElement);
    expect(screen.getByText('Nilai harus berupa angka.')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('menyesuaikan petunjuk keyboard saat titik meleset', () => {
    render(<MeasurementModal {...baseProps} offPoint={offPoint} onSkip={() => {}} />);
    expect(screen.getByText(/Esc untuk melewati titik ini/)).toBeTruthy();
    expect(screen.queryByText(/Esc untuk membatalkan/)).toBeNull();
  });
});