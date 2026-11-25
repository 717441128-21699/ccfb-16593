import { estimateTrackingThdPct } from '../audio/tracking';
import type {
  CollisionReport,
  GeometryConfig,
  PlanResult,
  RevolutionMetric,
  WarningMarker,
} from '../types';
import { samplesPerRevolution, type GrooveBuffer } from './groove';

export interface Excursion {
  index: number;
  t0: number;
  t1: number;
  lateralPeakMm: number;
  verticalPeakMm: number;
  depthMinMm: number;
  depthMaxMm: number;
  halfWidthMaxMm: number;
  slopeVelocityPeakMmPerSec: number;
}

const MACHINE_FEED_WARN_MM = 0.28;

export function excursionsFromGroove(
  groove: GrooveBuffer,
  durationSec: number,
  config: GeometryConfig,
): Excursion[] {
  const revDur = 60 / config.rpm;
  const count = Math.max(1, Math.ceil(durationSec / revDur));
  const spr = samplesPerRevolution(groove.sampleRate, config.rpm);
  const result: Excursion[] = [];

  for (let i = 0; i < count; i += 1) {
    const start = Math.max(0, Math.floor(i * spr));
    const end = Math.min(groove.lateral.length, Math.floor((i + 1) * spr));
    let lateralPeak = 0;
    let verticalPeak = 0;
    let depthMin = Infinity;
    let depthMax = -Infinity;
    let halfWidthMax = 0;
    let slopeVelocityPeak = 0;

    for (let j = start; j < end; j += 1) {
      const lat = Math.abs(groove.lateral[j]);
      const ver = Math.abs(groove.vertical[j]);
      if (lat > lateralPeak) lateralPeak = lat;
      if (ver > verticalPeak) verticalPeak = ver;
      if (groove.depth[j] < depthMin) depthMin = groove.depth[j];
      if (groove.depth[j] > depthMax) depthMax = groove.depth[j];
      if (groove.halfWidth[j] > halfWidthMax) halfWidthMax = groove.halfWidth[j];
      if (j > 0) {
        const dv = Math.abs(groove.lateral[j] - groove.lateral[j - 1]) * groove.sampleRate;
        if (dv > slopeVelocityPeak) slopeVelocityPeak = dv;
      }
    }

    if (!Number.isFinite(depthMin)) {
      depthMin = config.baseDepthMm;
      depthMax = config.baseDepthMm;
      halfWidthMax = config.kerfHalfWidthMm;
    }

    result.push({
      index: i,
      t0: i * revDur,
      t1: Math.min(durationSec, (i + 1) * revDur),
      lateralPeakMm: lateralPeak,
      verticalPeakMm: verticalPeak,
      depthMinMm: depthMin,
      depthMaxMm: depthMax,
      halfWidthMaxMm: halfWidthMax,
      slopeVelocityPeakMmPerSec: slopeVelocityPeak,
    });
  }
  return result;
}

export function planFromExcursions(
  excursions: Excursion[],
  durationSec: number,
  config: GeometryConfig,
  source: PlanResult['source'],
  planningStart?: number,
): PlanResult {
  const startWall = planningStart ?? performance.now();
  const revDur = 60 / config.rpm;
  const n = excursions.length;
  const reaches = excursions.map(
    (e) => e.lateralPeakMm + e.halfWidthMaxMm,
  );

  // Pair requirement is conservative over the whole revolution. A spiral's
  // same-angle separation is a blend of feed[i] and feed[i+1], so each feed
  // is raised by every adjacent pair it borders.
  const pairNeed = new Array<number>(Math.max(0, n - 1));
  const feeds = new Array<number>(n).fill(config.minPitchMm);
  for (let i = 0; i < n - 1; i += 1) {
    pairNeed[i] = reaches[i] + reaches[i + 1] + config.safetyMm;
    feeds[i] = Math.max(feeds[i], pairNeed[i]);
    feeds[i + 1] = Math.max(feeds[i + 1], pairNeed[i]);
  }

  const radii = new Array<number>(n + 1);
  radii[0] = config.outerRadiusMm;
  for (let i = 0; i < n; i += 1) radii[i + 1] = radii[i] - feeds[i];

  const warnings: WarningMarker[] = [];
  const metrics: RevolutionMetric[] = excursions.map((e, i) => {
    const startRadius = radii[i];
    const endRadius = radii[i + 1];
    const pairNeedMm = Math.max(
      i > 0 ? pairNeed[i - 1] : 0,
      i < pairNeed.length ? pairNeed[i] : 0,
    );
    const pitchToNextMm = feeds[i];
    const relevantClearances: number[] = [];
    if (i > 0) {
      relevantClearances.push(
        Math.min(feeds[i - 1], feeds[i]) - (pairNeed[i - 1] - config.safetyMm),
      );
    }
    if (i < n - 1) {
      relevantClearances.push(
        Math.min(feeds[i], feeds[i + 1]) - (pairNeed[i] - config.safetyMm),
      );
    }
    const clearanceMm = relevantClearances.length
      ? Math.min(...relevantClearances)
      : config.safetyMm;

    const effectiveFreq = Math.min(
      18000,
      Math.max(
        25,
        e.slopeVelocityPeakMmPerSec /
          (2 * Math.PI * Math.max(0.0012, e.lateralPeakMm)),
      ),
    );
    const maxTrackingThdPct = estimateTrackingThdPct({
      radiusMm: endRadius,
      freqHz: effectiveFreq,
      amplitudeMm: Math.max(0.0012, Math.min(0.012, e.lateralPeakMm * 0.35)),
      stylusRadiusMm: config.stylusRadiusMm,
      rpm: config.rpm,
    });

    const shallow = e.depthMinMm < config.shallowWarnMm;
    const lift = e.depthMinMm <= 0.0015;
    const overFeed = feeds[i] > MACHINE_FEED_WARN_MM;

    if (lift) {
      warnings.push({
        timeSec: e.t0,
        revolution: i,
        kind: 'lift',
        severity: 'danger',
        message: `第 ${i + 1} 圈纵向摆幅使刻刀抬出漆面（最小深度 ${(e.depthMinMm * 1000).toFixed(1)} µm）`,
      });
    } else if (shallow) {
      warnings.push({
        timeSec: e.t0,
        revolution: i,
        kind: 'shallow',
        severity: 'warning',
        message: `第 ${i + 1} 圈沟槽过浅（${(e.depthMinMm * 1000).toFixed(1)} µm）`,
      });
    }
    if (overFeed) {
      warnings.push({
        timeSec: e.t0,
        revolution: i,
        kind: 'over-feed',
        severity: 'warning',
        message: `第 ${i + 1} 圈变距 ${feeds[i].toFixed(3)} mm 超过保守进给提示`,
      });
    }
    if (endRadius < 92 && maxTrackingThdPct > 2.2) {
      warnings.push({
        timeSec: e.t0,
        revolution: i,
        kind: 'inner-distortion',
        severity: endRadius < config.innerLimitMm + 8 ? 'danger' : 'warning',
        message: `内圈半径 ${endRadius.toFixed(1)} mm，估算跟踪失真 ${maxTrackingThdPct.toFixed(1)}%`,
      });
    }

    return {
      index: i,
      t0: e.t0,
      t1: e.t1,
      startRadiusMm: startRadius,
      feedMm: feeds[i],
      endRadiusMm: endRadius,
      lateralPeakMm: e.lateralPeakMm,
      verticalPeakMm: e.verticalPeakMm,
      depthMinMm: e.depthMinMm,
      depthMaxMm: e.depthMaxMm,
      halfWidthMaxMm: e.halfWidthMaxMm,
      reachMaxMm: reaches[i],
      pairNeedMm,
      pitchToNextMm,
      clearanceMm: Number.isFinite(clearanceMm) ? clearanceMm : config.safetyMm,
      minTrackingSeverity: effectiveFreq,
      maxTrackingThdPct,
      shallow,
      lift,
      overFeed,
    };
  });

  const totalRadialMm = feeds.reduce((a, b) => a + b, 0);
  const endRadiusMm = radii[n];
  const availableRadialMm = config.outerRadiusMm - config.innerLimitMm;
  const variableMeanPitchMm = totalRadialMm / Math.max(1, n);
  const fixedSafePitchMm = pairNeed.length ? Math.max(...pairNeed) : config.minPitchMm;

  let fixedUserCollisions = 0;
  for (let i = 0; i < n - 1; i += 1) {
    if (config.fixedPitchMm + 1e-9 < pairNeed[i]) fixedUserCollisions += 1;
  }

  const variableCapacitySec =
    (availableRadialMm / variableMeanPitchMm) * revDur;
  const fixedSafeCapacitySec =
    (availableRadialMm / Math.max(config.minPitchMm, fixedSafePitchMm)) * revDur;

  // Envelope proof: every feed bordering pair i is at least pairNeed[i].
  let minEnvelopeClearance = Infinity;
  let collisions = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const guaranteed = Math.min(feeds[i], feeds[i + 1]) - pairNeed[i];
    if (guaranteed < -1e-9) collisions += 1;
    if (guaranteed < minEnvelopeClearance) minEnvelopeClearance = guaranteed;
  }

  const collision: CollisionReport = {
    checkedPairs: Math.max(0, n - 1),
    collisions,
    minClearanceMm: config.safetyMm + (Number.isFinite(minEnvelopeClearance) ? Math.max(0, minEnvelopeClearance) : 0),
    maxPenetrationMm: collisions ? Math.max(0, -minEnvelopeClearance) : 0,
    samplesPerRevolution: 0,
  };

  return {
    durationSec,
    revolutionDurationSec: revDur,
    revolutionCount: n,
    metrics,
    feedsMm: feeds,
    radiiMm: radii,
    totalRadialMm,
    endRadiusMm,
    availableRadialMm,
    fits: endRadiusMm + 1e-7 >= config.innerLimitMm,
    variableMeanPitchMm,
    fixedSafePitchMm,
    fixedUserPitchMm: config.fixedPitchMm,
    fixedUserCollisions,
    variableCapacitySec,
    fixedSafeCapacitySec,
    capacityGainPct: ((variableCapacitySec / fixedSafeCapacitySec - 1) * 100),
    warnings,
    collision,
    planningMs: performance.now() - startWall,
    source,
  };
}

export function planAudioMaster(
  groove: GrooveBuffer,
  durationSec: number,
  config: GeometryConfig,
): PlanResult {
  const start = performance.now();
  const excursions = excursionsFromGroove(groove, durationSec, config);
  const result = planFromExcursions(excursions, durationSec, config, 'audio', start);
  result.collision.samplesPerRevolution = samplesPerRevolution(
    groove.sampleRate,
    config.rpm,
  );
  const sampled = validateAudioCollisions(groove, result, config);
  result.collision = sampled;
  return result;
}

export function validateAudioCollisions(
  groove: GrooveBuffer,
  plan: PlanResult,
  config: GeometryConfig,
  bins = 1440,
): CollisionReport {
  const spr = samplesPerRevolution(groove.sampleRate, config.rpm);
  const binStep = Math.max(1, Math.floor(spr / bins));
  let checkedPairs = 0;
  let collisions = 0;
  let minClearance = Infinity;
  let maxPenetration = 0;

  for (let i = 0; i < plan.revolutionCount - 1; i += 1) {
    checkedPairs += 1;
    for (let u = 0; u < spr; u += binStep) {
      const idxA = i * spr + u;
      const idxB = (i + 1) * spr + u;
      if (idxA >= groove.lateral.length || idxB >= groove.lateral.length) break;
      const frac = u / spr;
      const nominalA = plan.radiiMm[i] - plan.feedsMm[i] * frac;
      const nominalB = plan.radiiMm[i + 1] - plan.feedsMm[i + 1] * frac;
      const centerA = nominalA + groove.lateral[idxA];
      const centerB = nominalB + groove.lateral[idxB];
      const clearance =
        centerA -
        groove.halfWidth[idxA] -
        (centerB + groove.halfWidth[idxB]);
      if (clearance < minClearance) minClearance = clearance;
      if (clearance < -0.00025) {
        collisions += 1;
        maxPenetration = Math.max(maxPenetration, -clearance);
      }
    }
  }

  return {
    checkedPairs,
    collisions,
    minClearanceMm: Number.isFinite(minClearance) ? minClearance : config.safetyMm,
    maxPenetrationMm: maxPenetration,
    samplesPerRevolution: spr,
  };
}
