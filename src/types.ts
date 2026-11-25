export type PageId = 'import' | 'geometry' | 'pitch' | 'listen';

export type MusicStyle = 'rock' | 'jazz' | 'classical' | 'electronic' | 'hiphop';

export interface StereoAudioBufferLike {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  durationSec: number;
}

export interface MasterTrack extends StereoAudioBufferLike {
  id: string;
  title: string;
  artist: string;
  style: MusicStyle;
  generated: boolean;
  description: string;
  bpm: number;
}

export interface EnvelopePoint {
  t: number;
  rms: number;
  peak: number;
  bass: number;
  high: number;
  side: number;
}

export interface MasterEnvelope {
  points: EnvelopePoint[];
  blockSec: number;
}

export interface GeometryConfig {
  rpm: number;
  outerRadiusMm: number;
  innerLimitMm: number;
  minPitchMm: number;
  fixedPitchMm: number;
  safetyMm: number;
  velocityGainMmPerSec: number;
  dcServoHz: number;
  baseDepthMm: number;
  verticalTrim: number;
  grooveAngleDeg: number;
  kerfHalfWidthMm: number;
  shallowWarnMm: number;
  stylusRadiusMm: number;
  riaaEnabled: boolean;
}

export const DEFAULT_GEOMETRY_CONFIG: GeometryConfig = {
  rpm: 33 + 1 / 3,
  outerRadiusMm: 146,
  innerLimitMm: 57.5,
  minPitchMm: 0.074,
  fixedPitchMm: 0.112,
  safetyMm: 0.006,
  velocityGainMmPerSec: 82,
  dcServoHz: 18,
  baseDepthMm: 0.041,
  verticalTrim: 0.58,
  grooveAngleDeg: 60,
  kerfHalfWidthMm: 0.005,
  shallowWarnMm: 0.02,
  stylusRadiusMm: 0.0152,
  riaaEnabled: true,
};

export interface RevolutionMetric {
  index: number;
  t0: number;
  t1: number;
  startRadiusMm: number;
  feedMm: number;
  endRadiusMm: number;
  lateralPeakMm: number;
  verticalPeakMm: number;
  depthMinMm: number;
  depthMaxMm: number;
  halfWidthMaxMm: number;
  reachMaxMm: number;
  pairNeedMm: number;
  pitchToNextMm: number;
  clearanceMm: number;
  minTrackingSeverity: number;
  maxTrackingThdPct: number;
  shallow: boolean;
  lift: boolean;
  overFeed: boolean;
}

export interface WarningMarker {
  timeSec: number;
  revolution: number;
  kind: 'shallow' | 'lift' | 'over-feed' | 'inner-distortion';
  severity: 'warning' | 'danger';
  message: string;
}

export interface CollisionReport {
  checkedPairs: number;
  collisions: number;
  minClearanceMm: number;
  maxPenetrationMm: number;
  samplesPerRevolution: number;
}

export interface PlanResult {
  durationSec: number;
  revolutionDurationSec: number;
  revolutionCount: number;
  metrics: RevolutionMetric[];
  feedsMm: number[];
  radiiMm: number[];
  totalRadialMm: number;
  endRadiusMm: number;
  availableRadialMm: number;
  fits: boolean;
  variableMeanPitchMm: number;
  fixedSafePitchMm: number;
  fixedUserPitchMm: number;
  fixedUserCollisions: number;
  variableCapacitySec: number;
  fixedSafeCapacitySec: number;
  capacityGainPct: number;
  warnings: WarningMarker[];
  collision: CollisionReport;
  planningMs: number;
  source: 'audio' | 'program-envelope';
}

export interface GeometrySample {
  t: number;
  radiusMm: number;
  lateralMm: number;
  verticalMm: number;
  depthMm: number;
  halfWidthMm: number;
  leftMm: number;
  rightMm: number;
}
