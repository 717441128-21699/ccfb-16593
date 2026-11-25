import { describe, expect, it } from 'vitest';
import { generateStyleTrack, STYLE_LIST } from './audio/generateMusic';
import { createProgram22Excursions, PROGRAM_22MIN_SEC } from './audio/longProgram';
import { estimateTrackingThdPct } from './audio/tracking';
import { riaaCascadeErrorDb } from './audio/riaa';
import { computeGrooveBuffer } from './geometry/groove';
import { planAudioMaster, planFromExcursions } from './geometry/planner';
import { DEFAULT_GEOMETRY_CONFIG } from './types';

const frequencies = [20, 31.5, 50, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000];

describe('RIAA equalization', () => {
  it('pre-emphasis and de-emphasis cascade stays within 0.5 dB', () => {
    for (const sampleRate of [44100, 48000, 96000]) {
      const errors = riaaCascadeErrorDb(sampleRate, frequencies);
      for (const { freq, errorDb } of errors) {
        expect(Math.abs(errorDb), `${sampleRate} Hz @ ${freq} Hz`).toBeLessThan(0.5);
      }
    }
  });
});

describe('variable-pitch geometry constraints', () => {
  it('plans the composed 22-minute side in under one minute with zero intersections', () => {
    const start = performance.now();
    const excursions = createProgram22Excursions(DEFAULT_GEOMETRY_CONFIG);
    const plan = planFromExcursions(
      excursions,
      PROGRAM_22MIN_SEC,
      DEFAULT_GEOMETRY_CONFIG,
      'program-envelope',
      start,
    );

    expect(plan.revolutionCount).toBe(734);
    expect(plan.collision.checkedPairs).toBe(733);
    expect(plan.collision.collisions).toBe(0);
    expect(plan.collision.maxPenetrationMm).toBe(0);
    expect(plan.collision.minClearanceMm).toBeGreaterThanOrEqual(DEFAULT_GEOMETRY_CONFIG.safetyMm - 1e-9);
    expect(plan.planningMs).toBeLessThan(60_000);
    expect(plan.capacityGainPct).toBeGreaterThan(25);
    expect(plan.variableCapacitySec).toBeGreaterThan(plan.fixedSafeCapacitySec * 1.25);
  });

  it('fits the 22-minute benchmark inside the default lacquer radial area', () => {
    const plan = planFromExcursions(
      createProgram22Excursions(DEFAULT_GEOMETRY_CONFIG),
      PROGRAM_22MIN_SEC,
      DEFAULT_GEOMETRY_CONFIG,
      'program-envelope',
    );
    expect(plan.fits).toBe(true);
    expect(plan.endRadiusMm).toBeGreaterThanOrEqual(DEFAULT_GEOMETRY_CONFIG.innerLimitMm);
    expect(plan.durationSec).toBe(22 * 60);
  });

  for (const style of STYLE_LIST) {
    it(`keeps adjacent audio grooves disjoint for generated ${style} master`, () => {
      const track = generateStyleTrack(style, { durationSec: 14, sampleRate: 44100 });
      const groove = computeGrooveBuffer(track, DEFAULT_GEOMETRY_CONFIG);
      const plan = planAudioMaster(groove, track.durationSec, DEFAULT_GEOMETRY_CONFIG);

      expect(plan.collision.collisions, JSON.stringify({
        style,
        minClearance: plan.collision.minClearanceMm,
        maxPenetration: plan.collision.maxPenetrationMm,
        fixed: plan.fixedSafePitchMm,
        mean: plan.variableMeanPitchMm,
      })).toBe(0);
      expect(plan.collision.minClearanceMm).toBeGreaterThan(0);
      expect(plan.revolutionCount).toBeGreaterThan(5);
    });
  }
});

describe('needle tracking distortion', () => {
  it('increases monotonically as radius decreases', () => {
    const radii = [146, 130, 110, 90, 75, 65, 57.5];
    const thds = radii.map((radiusMm) =>
      estimateTrackingThdPct({
        radiusMm,
        stylusRadiusMm: DEFAULT_GEOMETRY_CONFIG.stylusRadiusMm,
        rpm: DEFAULT_GEOMETRY_CONFIG.rpm,
      }),
    );
    for (let i = 1; i < thds.length; i += 1) {
      expect(thds[i]).toBeGreaterThan(thds[i - 1]);
    }
    expect(thds.at(-1)).toBeGreaterThan(thds[0] * 2);
  });
});
