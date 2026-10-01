import React, { useEffect, useRef, useState } from 'react';
import { X, Save, AlertTriangle, SkipForward } from 'lucide-react';
import { formatDeltaCm, type ArrivalReport } from '../arrival';

interface MeasurementModalProps {
  meter: number;
  direction: 'UP' | 'DOWN';
  isCalibration: boolean;
  isOpen: boolean;
  /**
   * Status kedatangan di luar titik dari firmware. null = kedatangan normal
   * (jarak rotasi cocok DAN sensor A0 mengonfirmasi). Non-null = motor berhenti
   * meleset dari target dan operator WAJIB diberi tahu serta memutuskan.
   */
  offPoint?: ArrivalReport | null;
  onClose: () => void;
  onConfirm: (value: number) => void;
  /** Operator memilih "Lewati Titik": tidak ada nilai yang dicatat, motor lanjut. */
  onSkip?: () => void;
}

export const MeasurementModal: React.FC<MeasurementModalProps> = ({
  meter,
  direction,
  isCalibration,
  isOpen,
  offPoint = null,
  onClose,
  onConfirm,
  onSkip
}) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Sebagian firmware/uji lama tidak mengirim ARRIVE: sama sekali. Tanpa
  // laporan itu tidak boleh ada peringatan meleset — lebih baik diam daripada
  // mengarang angka.
  const hasOffPoint = offPoint !== null;

  useEffect(() => {
    if (isOpen) {
      setInput('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen, meter, direction]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const value = Number(input);
    if (input.trim() === '' || !Number.isFinite(value)) {
      setError('Nilai harus berupa angka.');
      if (inputRef.current) inputRef.current.focus();
      return;
    }
    onConfirm(value);
  };

  const handleSkip = () => {
    if (!onSkip) return;
    setError('');
    onSkip();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      setError('');
      if (hasOffPoint && onSkip) handleSkip();
      else onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="modal-measurement"
        className="bg-[#151822] border border-blue-700/60 rounded-xl w-full max-w-md text-zinc-200 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-[#12141c] border-b border-zinc-800 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Save className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">INPUT HASIL PENGUJIAN</h2>
              <p className="text-xs text-zinc-400">
                Titik {meter} m — Uji {direction === 'UP' ? 'Naik' : 'Turun'}
                {isCalibration ? ' (nilai standar kalibrasi)' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {hasOffPoint && offPoint && (
            <div
              id="lbl-measurement-offpoint"
              role="alert"
              className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-amber-300">
                  MOTOR BERHENTI DI LUAR TITIK UJI
                </p>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Posisi pillar meleset{' '}
                <span className="font-mono font-semibold">
                  {formatDeltaCm(offPoint.deltaMm)}
                </span>{' '}
                dari target {offPoint.targetMm} mm ({offPoint.posMm} mm).
                Sensor A0 tidak mengonfirmasi platelet di titik ini, jadi
                NILAI YANG DIISIKAN INI BUKAN PENGUKURAN DI TITIK UJI.
              </p>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Pilih <span className="font-semibold">Isi Nilai &amp; Simpan</span>{' '}
                bila pengukuran ini tetap dipakai, atau{' '}
                <span className="font-semibold">Lewati Titik</span> bila
                diabaikan. Semua pilihan dicatat di log.
              </p>
            </div>
          )}
          <label className="block text-zinc-400 text-xs font-medium">
            Nilai Pembacaan ({isCalibration ? 'mm standar' : 'mm'})
          </label>
          <input
            ref={inputRef}
            id="input-measurement-value"
            type="number"
            step="0.001"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 font-mono focus:border-blue-500 focus:outline-none"
            placeholder="Contoh: 5000.000"
          />
          {error && (
            <p id="lbl-measurement-error" className="text-rose-400 text-[11px]">
              {error}
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            {hasOffPoint
              ? 'Tekan Enter untuk mengisi nilai & menyimpan, atau Esc untuk melewati titik ini.'
              : 'Tekan Enter untuk menyimpan, atau Esc untuk membatalkan.'}
          </p>
        </div>

        {/* Footer */}
        <div className="bg-[#12141c] border-t border-zinc-800 px-5 py-3 flex items-center justify-end gap-2.5">
          {hasOffPoint && onSkip ? (
            // Titik di luar titik uji: tepat DUA pilihan yang bermakna —
            // catat nilainya, atau lewati titiknya. "Batal" disembunyikan karena
            // itu akan jadi pintasan ketiga yang sama saja dengan Lewati Titik.
            <button
              id="btn-measurement-skip"
              onClick={handleSkip}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-600/60 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-semibold transition"
            >
              <SkipForward className="w-4 h-4" />
              <span>Lewati Titik</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setError('');
                onClose();
              }}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition"
            >
              Batal
            </button>
          )}
          <button
            id="btn-measurement-save"
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition"
          >
            <Save className="w-4 h-4" />
            <span>{hasOffPoint ? 'Isi Nilai & Simpan' : 'Simpan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};