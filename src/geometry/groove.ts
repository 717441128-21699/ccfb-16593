import { RiaaFilter } from '../audio/riaa';
import type { GeometryConfig, MasterTrack } from '../types';

export interface GrooveBuffer {
  sampleRate: number;
  oversample: number;
  lateral: Float32Array;
  vertical: Float32Array;
  depth: Float32Array;
  halfWidth: Float32Array;
}

export function grooveHalfWidthMm(depthMm: number, config: GeometryConfig): number {
  const effectiveDepth = Math.max(0, depthMm);
  return (
    config.kerfHalfWidthMm +
    effectiveDepth * Math.tan((config.grooveAngleDeg * Math.PI) / 360)
  );
}

/**
 * Convert stereo master to 45/45 lateral/vertical cutter motion.
 * The incoming normalized audio is treated as cutter velocity. RIAA
 * pre-emphasis is applied first; a leaky integrator turns velocity into
 * physical displacement and models the cutter-head DC servo.
 *
 * Geometry runs at 2x sample rate so the bilinear RIAA transform is not
 * warped hard against the source Nyquist edge.
 */
export function computeGrooveBuffer(
  track: Pick<MasterTrack, 'left' | 'right' | 'sampleRate'>,
  config: GeometryConfig,
): GrooveBuffer {
  const oversample = 2;
  const sampleRate = track.sampleRate * oversample;
  const n = track.left.length * oversample;
  const lateral = new Float32Array(n);
  const vertical = new Float32Array(n);
  const depth = new Float32Array(n);
  const halfWidth = new Float32Array(n);

  const pre = new RiaaFilter(sampleRate, 'pre', 2);
  const leak = Math.exp((-2 * Math.PI * config.dcServoHz) / sampleRate);
  let intL = 0;
  let intR = 0;

  const interpolate = (data: Float32Array, pos: number): number => {
    const i = Math.floor(pos);
    const f = pos - i;
    const a = data[Math.min(data.length - 1, Math.max(0, i))] ?? 0;
    const b = data[Math.min(data.length - 1, Math.max(0, i + 1))] ?? a;
    return a + (b - a) * f;
  };

  for (let i = 0; i < n; i += 1) {
    const srcPos = i / oversample;
    const rawL = interpolate(track.left, srcPos);
    const rawR = track.right === track.left ? rawL : interpolate(track.right, srcPos);
    const pL = config.riaaEnabled ? pre.processSample(rawL, 0) : rawL;
    const pR = config.riaaEnabled ? pre.processSample(rawR, 1) : rawR;

    intL = leak * intL + (config.velocityGainMmPerSec * pL) / sampleRate;
    intR = leak * intR + (config.velocityGainMmPerSec * pR) / sampleRate;

    const lat = (intL + intR) / Math.SQRT2;
    const ver = ((intL - intR) / Math.SQRT2) * config.verticalTrim;
    lateral[i] = lat;
    vertical[i] = ver;

    // Positive vertical motion raises the cutter and reduces lacquer depth.
    const d = config.baseDepthMm - ver;
    depth[i] = d;
    halfWidth[i] = grooveHalfWidthMm(d, config);
  }

  return { sampleRate, oversample, lateral, vertical, depth, halfWidth };
}

export function samplesPerRevolution(sampleRate: number, rpm: number): number {
  return Math.round((sampleRate * 60) / rpm);
}

export function downsampleExtrema(values: Float32Array, buckets: number): {
  min: Float32Array;
  max: Float32Array;
} {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (values.length === 0) return { min, max };
  const bucketSize = values.length / buckets;
  for (let b = 0; b < buckets; b += 1) {
    const start = Math.floor(b * bucketSize);
    const end = Math.max(start + 1, Math.floor((b + 1) * bucketSize));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < Math.min(values.length, end); i += 1) {
      const v = values[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}
