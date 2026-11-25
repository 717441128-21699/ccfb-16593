import { grooveHalfWidthMm } from '../geometry/groove';
import type { Excursion } from '../geometry/planner';
import { DEFAULT_GEOMETRY_CONFIG, type GeometryConfig, type MusicStyle } from '../types';

export const PROGRAM_22MIN_SEC = 22 * 60;

export interface ProgramSection {
  startSec: number;
  endSec: number;
  style: MusicStyle | 'finale';
  title: string;
  energy: number;
  dynamics: number;
}

export const PROGRAM_22MIN_SECTIONS: ProgramSection[] = [
  { startSec: 0, endSec: 120, style: 'electronic', title: '开场：内圈霓虹序曲', energy: 0.34, dynamics: 0.22 },
  { startSec: 120, endSec: 330, style: 'jazz', title: '深夜爵士三重奏', energy: 0.15, dynamics: 0.16 },
  { startSec: 330, endSec: 540, style: 'rock', title: '冲床之夜（摇滚）', energy: 0.66, dynamics: 0.2 },
  { startSec: 540, endSec: 690, style: 'classical', title: '古典：极弱慢板', energy: 0.1, dynamics: 0.08 },
  { startSec: 690, endSec: 780, style: 'classical', title: '古典：强奏齐奏', energy: 0.76, dynamics: 0.18 },
  { startSec: 780, endSec: 960, style: 'hiphop', title: 'Boom-bap 段落', energy: 0.43, dynamics: 0.16 },
  { startSec: 960, endSec: 1170, style: 'electronic', title: '合成器浪潮推进', energy: 0.58, dynamics: 0.24 },
  { startSec: 1170, endSec: 1320, style: 'finale', title: '整面终曲：摇滚 × 电子', energy: 0.8, dynamics: 0.18 },
];

function sectionAt(t: number): ProgramSection {
  return (
    PROGRAM_22MIN_SECTIONS.find((s) => t >= s.startSec && t < s.endSec) ??
    PROGRAM_22MIN_SECTIONS[PROGRAM_22MIN_SECTIONS.length - 1]
  );
}

/**
 * Deterministic revolution-scale envelope for the composed 22-minute side.
 * It avoids allocating a ~470 MB stereo Float32 master while retaining the
 * same physical peak quantities used by the audio-backed planner.
 */
export function createProgram22Excursions(
  config: GeometryConfig = DEFAULT_GEOMETRY_CONFIG,
): Excursion[] {
  const revDur = 60 / config.rpm;
  const count = Math.ceil(PROGRAM_22MIN_SEC / revDur);
  const excursions: Excursion[] = [];
  // Deliberate rare worst-case lacquer-cut peaks. A fixed pitch must reserve
  // space for these everywhere; variable pitch opens only nearby revolutions.
  const hotRevolutions = new Set([146, 259, 337, 421, 506, 704, 716, 728]);

  for (let i = 0; i < count; i += 1) {
    const t = i * revDur + revDur * 0.5;
    const section = sectionAt(t);
    const local = (t - section.startSec) / Math.max(1, section.endSec - section.startSec);
    const phrase = 0.5 + 0.5 * Math.sin(t * (section.style === 'jazz' ? 0.43 : 0.81) + i * 0.37);
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * (section.style === 'classical' ? 0.7 : 1.9)), 2);
    let energy = Math.max(
      0.035,
      Math.min(0.96, section.energy + (phrase - 0.5) * section.dynamics + pulse * section.dynamics * 0.45),
    );

    // Classical has intentional near-silent passages.
    if (section.style === 'classical' && t < 690) {
      energy *= 0.55 + 0.3 * Math.sin(local * Math.PI * 5) ** 2;
    }

    let lateralPeak = 0.0026 + 0.041 * Math.pow(energy, 1.42);
    let verticalPeak = 0.0024 + 0.0175 * energy * (0.72 + 0.28 * phrase);

    if (hotRevolutions.has(i)) {
      lateralPeak = 0.071 + 0.004 * ((i % 3) - 1);
      // Two deliberate out-of-phase over-cut test points lift the cutter.
      verticalPeak = i === 704 || i === 728 ? 0.047 : 0.0215;
      energy = 1;
    }

    // A few very quiet jazz/classical revolutions can tighten to minimum pitch.
    if ((section.style === 'jazz' || section.style === 'classical') && phrase < 0.16 && energy < 0.11) {
      lateralPeak *= 0.42;
      verticalPeak *= 0.72;
    }

    const depthMin = config.baseDepthMm - verticalPeak;
    const depthMax = config.baseDepthMm + verticalPeak * 1.08;
    const halfWidthMax = grooveHalfWidthMm(depthMax, config);
    const effectiveFreq =
      section.style === 'electronic' ? 5200 :
      section.style === 'jazz' ? 2600 :
      section.style === 'classical' ? 1800 : 3400;
    const slopeVelocityPeak = lateralPeak * 2 * Math.PI * effectiveFreq;

    excursions.push({
      index: i,
      t0: i * revDur,
      t1: Math.min(PROGRAM_22MIN_SEC, (i + 1) * revDur),
      lateralPeakMm: lateralPeak,
      verticalPeakMm: verticalPeak,
      depthMinMm: depthMin,
      depthMaxMm: depthMax,
      halfWidthMaxMm: halfWidthMax,
      slopeVelocityPeakMmPerSec: slopeVelocityPeak,
    });
  }
  return excursions;
}
