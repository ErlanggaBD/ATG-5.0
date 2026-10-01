import React from 'react';
import { MotorStatus } from '../types';
import { Compass, Home, Target, ArrowRight, Gauge, AlertCircle } from 'lucide-react';

// ATG-5.0: rel FISIK hanya ~13 m, sementara skalanya tertulis 5-17 m.
// Limit A1 ujung bawah ("ZERO") berada 300 mm di belakang plat 5 m, jadi dalam
// skala-label ia ada di 4,7 m. Ujung atas rel ada di 17,7 m, yaitu 0,7 m di
// belakang plat 17 m. Jadi area rel yang digambar adalah 4,7 m .. 17,7 m:
//   [4,7] limit bawah - [5..17] plat uji (13 titik) - [17,7] limit atas
const MIN_TRACK_METER = 4.7;   // limit A1 ujung bawah (ZERO)
const MAX_TRACK_METER = 17.7;  // limit A1 ujung atas (HOME)
const FIRST_TEST_METER = 5;
const LAST_TEST_METER = 17;
const TRACK_START_PERCENT = 5;
const TRACK_END_PERCENT = 95;

interface MotorTrackVisualizerProps {
  motorStatus: MotorStatus;
  onMoveToMeter: (meter: number) => void;
  // ===== KOREKSI SENIOR =====
  // 'HOME'/'ZERO' = firmware sedang mencari limit A1. During that time the app
  // does NOT know where the pillar is, so the carriage marker is hidden and no
  // position number is rendered. 'NONE' = motor is not searching a limit.
  calibSearch?: 'NONE' | 'HOME' | 'ZERO';
  // true hanya setelah firmware melaporkan posisi nyata (HOME_DONE / ZERO_DONE /
  // POS_DONE:<mm>). Sebelum itu posisi pillar tidak diketahui sama sekali —
  // angka 0.000 m bawaan aplikasi bukan hasil pengukuran.
  positionKnown?: boolean;
}

export const MotorTrackVisualizer: React.FC<MotorTrackVisualizerProps> = ({
  motorStatus,
  onMoveToMeter,
  calibSearch = 'NONE',
  positionKnown = false
}) => {
  const currentPos = motorStatus.currentPositionMeter;
  const isSearching = calibSearch !== 'NONE';
  // Pilar hanya digambar bila posisinya benar-benar diketahui dari firmware.
  // Saat mencari sensor (atau sebelum kalibrasi pertama) marker disembunyikan
  // supaya operator tidak melihat posisi karangan.
  const showPillar = positionKnown && !isSearching;
  // Keep the motor, ticks, and reference lines on the same 5% - 95% visual scale.
  const pctFor = (m: number) =>
    TRACK_START_PERCENT +
    ((m - MIN_TRACK_METER) / (MAX_TRACK_METER - MIN_TRACK_METER)) *
      (TRACK_END_PERCENT - TRACK_START_PERCENT);
  const posPercentage = Math.min(TRACK_END_PERCENT, Math.max(TRACK_START_PERCENT, pctFor(currentPos)));

  return (
    <div className="bg-[#151821] border-b border-zinc-800/80 px-4 py-2.5 text-zinc-300 text-xs select-none">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-blue-400" />
            LINTASAN REL ATG HORIZONTAL (SKALA-LABEL 4.7 - 17.7 METER):
          </span>
          <span className="text-[11px] text-zinc-400">
            Limit: <strong className="text-amber-300 font-mono">4.7m (ZERO)</strong> & <strong className="text-emerald-300 font-mono">17.7m (HOME)</strong>
            {' '}• titik uji <strong className="text-zinc-300 font-mono">5 - 17m</strong>
            {' '}(rel fisik ±13m)
          </span>
        </div>

        {/* Sensors Indicators */}
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${motorStatus.zeroSensorActive ? 'bg-amber-400 animate-ping' : 'bg-zinc-700'}`}></span>
            <span className={motorStatus.zeroSensorActive ? 'text-amber-400 font-bold' : 'text-zinc-500'}>Limit Bawah (Zero)</span>
          </div>
          <div className="w-[1px] h-3 bg-zinc-800"></div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${motorStatus.homeSensorActive ? 'bg-emerald-400 animate-ping' : 'bg-zinc-700'}`}></span>
            <span className={motorStatus.homeSensorActive ? 'text-emerald-400 font-bold' : 'text-zinc-500'}>Limit Atas (Home)</span>
          </div>
          <div className="w-[1px] h-3 bg-zinc-800"></div>
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Kecepatan:</span>
            <span className="font-mono text-zinc-300 font-semibold">{motorStatus.speedMmPerSec} mm/s</span>
          </div>
        </div>
      </div>

      {/* Track Visual Container */}
      <div className="relative w-full h-8 bg-zinc-950/80 rounded-md border border-zinc-800 overflow-hidden flex items-center px-3">
        {/* Rail background dashes */}
        <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-1 bg-zinc-800 rounded"></div>

        {/* Limit A1 ujung bawah (ZERO) — koordinat 4,7 m skala-label, yaitu
            300 mm di belakang plat 5 m. */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-amber-500/80 z-10 flex flex-col items-center justify-between"
          style={{ left: `${pctFor(MIN_TRACK_METER)}%` }}
        >
          <div className="bg-amber-500 text-black text-[9px] font-black px-1 rounded-b shadow">ZERO</div>
        </div>

        {/* Limit A1 ujung atas (HOME) — 0,7 m di belakang plat 17 m. */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-emerald-500/80 z-10 flex flex-col items-center justify-between"
          style={{ left: `${pctFor(MAX_TRACK_METER)}%` }}
        >
          <div className="bg-emerald-500 text-black text-[9px] font-black px-1 rounded-b shadow">HOME</div>
        </div>

        {/* Tick mark tiap plat uji 5 - 17 m (13 titik) */}
        {Array.from({ length: LAST_TEST_METER - FIRST_TEST_METER + 1 }, (_, i) => FIRST_TEST_METER + i).map((m) => {
          const isFirst = m === FIRST_TEST_METER;
          const isLast = m === LAST_TEST_METER;
          return (
            <button
              key={m}
              id={`track-tick-${m}`}
              onClick={() => onMoveToMeter(m)}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 group cursor-pointer"
              style={{ left: `${pctFor(m)}%` }}
              title={`Klik untuk menggerakkan motor ke plat ${m} meter`}
            >
              <div className={`w-1.5 h-3 rounded-xs ${isFirst ? 'bg-amber-400' : isLast ? 'bg-emerald-400' : 'bg-zinc-600 group-hover:bg-blue-400'}`}></div>
              <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[9px] text-zinc-500 group-hover:text-blue-300 font-mono">
                {m}
              </span>
            </button>
          );
        })}

        {/* Moving Stepper Carriage — hanya saat posisi pillar benar-benar
            diketahui dari firmware (HOME_DONE / ZERO_DONE / POS_DONE). */}
        {showPillar && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 transition-all duration-800 ease-out flex items-center justify-center"
            style={{ left: `${posPercentage}%` }}
          >
            <div
              id="lbl-motor-posisi"
              className={`px-2 py-0.5 rounded shadow-lg border text-[10px] font-mono font-bold flex items-center gap-1 ${
                motorStatus.isMoving
                  ? 'bg-blue-600 text-white border-blue-400 animate-pulse'
                  : 'bg-zinc-800 text-cyan-300 border-cyan-500/50'
              }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              MOTOR: {currentPos.toFixed(3)}m
            </div>
          </div>
        )}

        {/* Posisi belum diketahui: sedang mencari sensor, atau kalibrasi HOME
            pertama belum dilakukan sama sekali. */}
        {!showPillar && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <span
              id="lbl-posisi-belum-diketahui"
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded border font-mono font-bold text-[10px] ${
                isSearching
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse'
                  : 'bg-zinc-800/80 border-zinc-700 text-zinc-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isSearching ? 'bg-amber-400 animate-pulse' : 'bg-zinc-600'}`}></span>
              {isSearching
                ? `Mencari sensor ${calibSearch}… (posisi belum diketahui)`
                : 'Posisi pillar belum diketahui — tekan HOME (limit atas)'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
