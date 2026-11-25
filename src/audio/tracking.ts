import type { GeometryConfig } from '../types';

export function discAngularVelocity(rpm: number): number {
  return (2 * Math.PI * rpm) / 60;
}

export function linearVelocityMmPerSec(radiusMm: number, rpm: number): number {
  return discAngularVelocity(rpm) * radiusMm;
}

/**
 * Dimensionless finite-tip tracing index for a sinusoidal modulation.
 * Spatial slope p = A*2*pi*f/v; the stylus-radius correction relative to A
 * is approximately r*A*(2*pi*f)^2/(2*v^2).
 */
export function trackingIndex(input: {
  radiusMm: number;
  freqHz: number;
  amplitudeMm: number;
  stylusRadiusMm: number;
  rpm: number;
}): number {
  const v = linearVelocityMmPerSec(input.radiusMm, input.rpm);
  const omegaAudio = 2 * Math.PI * Math.max(1, input.freqHz);
  return (
    (input.stylusRadiusMm * input.amplitudeMm * omegaAudio * omegaAudio) /
    (2 * v * v)
  );
}

/** Smooth engineering estimate used by the radius/THD chart. */
export function estimateTrackingThdPct(input: {
  radiusMm: number;
  freqHz?: number;
  amplitudeMm?: number;
  stylusRadiusMm: number;
  rpm: number;
}): number {
  const k = trackingIndex({
    radiusMm: input.radiusMm,
    freqHz: input.freqHz ?? 5000,
    amplitudeMm: input.amplitudeMm ?? 0.0032,
    stylusRadiusMm: input.stylusRadiusMm,
    rpm: input.rpm,
  });
  // Low-order geometric tracing products followed by onset of mistracking.
  // Coefficients are calibrated so an outer-radius 5 kHz tone stays near
  // roughly 1-2% THD while the same tone approaches high single/double
  // digits near the innermost radius.
  const thd = 100 * (0.12 * k + 0.18 * k * k + 0.25 * k * k * k);
  return Math.min(24, thd);
}

export interface NeedleModelOptions {
  stylusRadiusMm: number;
  rpm: number;
  velocityGainMmPerSec: number;
  mix?: number;
}

/**
 * TypeScript twin of public/worklets/tracking-processor.js.
 * Keep the equations in sync; the AudioWorklet is the audible implementation.
 */
export class NeedleTrackingModel {
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevTracedZ = 0;

  constructor(private options: NeedleModelOptions) {}

  reset(): void {
    this.prevX = 0;
    this.prevY = 0;
    this.prevZ = 0;
    this.prevTracedZ = 0;
  }

  process(lateralMm: number, verticalMm: number, radiusMm: number): {
    left: number;
    right: number;
    distortion: number;
  } {
    const fs = 44100;
    const omega = discAngularVelocity(this.options.rpm);
    const v = Math.max(8, omega * Math.max(8, radiusMm));
    const r = this.options.stylusRadiusMm;
    const mix = this.options.mix ?? 1;

    const dxdt = (lateralMm - this.prevX) * fs;
    this.prevX = lateralMm;
    const slope = dxdt / v;
    const slope2 = slope * slope;
    const slope4 = slope2 * slope2;

    // Normal-offset expansion of a circular stylus following a curved wall,
    // plus a gentle third-order contact/mistracking term.
    const offset = -0.5 * r * slope2 + 0.375 * r * slope4;
    const contact = r * 0.22 * Math.tanh(slope * 1.7) ** 3;
    const tracedX = lateralMm + mix * (offset + contact);
    const dTracedDt = (tracedX - this.prevY) * fs;
    this.prevY = tracedX;
    const lateralSignal = dTracedDt / this.options.velocityGainMmPerSec;

    const dzdt = (verticalMm - this.prevZ) * fs;
    this.prevZ = verticalMm;
    const zSlope = dzdt / v;
    const tracedZ =
      verticalMm + mix * (-0.32 * r * zSlope * zSlope + r * 0.12 * Math.tanh(zSlope) ** 3);
    const dZdt = (tracedZ - this.prevTracedZ) * fs;
    this.prevTracedZ = tracedZ;
    const verticalSignal = dZdt / this.options.velocityGainMmPerSec;

    const left = (lateralSignal + verticalSignal) / Math.SQRT2;
    const right = (lateralSignal - verticalSignal) / Math.SQRT2;
    const distortion = Math.min(1, Math.abs(offset + contact) / Math.max(0.002, Math.abs(lateralMm) + 1e-6));
    return { left, right, distortion };
  }
}

export function radiusForTime(
  timeSec: number,
  durationSec: number,
  radiiMm: number[],
): number {
  if (radiiMm.length === 0) return 100;
  const p = Math.min(0.999999, Math.max(0, timeSec / Math.max(0.001, durationSec)));
  const pos = p * (radiiMm.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = radiiMm[i];
  const b = radiiMm[Math.min(radiiMm.length - 1, i + 1)];
  return a + (b - a) * f;
}

export function defaultThdCurve(config: GeometryConfig): Array<{ radius: number; thd: number }> {
  const radii = [146, 135, 120, 105, 90, 75, 65, 57.5];
  return radii.map((radius) => ({
    radius,
    thd: estimateTrackingThdPct({
      radiusMm: radius,
      stylusRadiusMm: config.stylusRadiusMm,
      rpm: config.rpm,
    }),
  }));
}
