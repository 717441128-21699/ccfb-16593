import type { MasterTrack, MusicStyle } from '../types';

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

interface RenderOptions {
  durationSec?: number;
  sampleRate?: number;
}

class MusicRenderer {
  readonly left: Float32Array;
  readonly right: Float32Array;
  private readonly noise: Float32Array;
  private noisePos = 0;

  constructor(
    readonly sampleRate: number,
    readonly durationSec: number,
    seed: number,
    private readonly style: MusicStyle,
  ) {
    const n = Math.floor(sampleRate * durationSec);
    this.left = new Float32Array(n);
    this.right = new Float32Array(n);
    const rand = random(seed);
    this.noise = new Float32Array(sampleRate * 2);
    for (let i = 0; i < this.noise.length; i += 1) this.noise[i] = rand() * 2 - 1;
  }

  private nextNoise(): number {
    this.noisePos = (this.noisePos + 1) % this.noise.length;
    return this.noise[this.noisePos];
  }

  /** Intentional album-side arrangement dynamics: intros and breakdowns. */
  private energyAt(timeSec: number): number {
    const p = timeSec / this.durationSec;
    if (this.style === 'classical') {
      if (p < 0.62) return 0.24 + 0.06 * Math.sin(p * 22);
      return 1.3;
    }
    if (this.style === 'jazz') {
      if (p < 0.24) return 0.3;
      if (p > 0.55 && p < 0.78) return 0.12;
      return 0.92;
    }
    if (p < 0.18) return 0.32;
    if (p > 0.5 && p < 0.72) return 0.12;
    if (p > 0.86) return 1.24;
    return 1.04;
  }

  addTone(input: {
    start: number;
    dur: number;
    freq: number;
    gain: number;
    pan?: number;
    type?: OscillatorType | 'rhodes' | 'cello';
    attack?: number;
    release?: number;
    harmonics?: number[];
    vibrato?: number;
  }): void {
    const {
      start, dur, freq, gain, pan = 0, type = 'sine',
      attack = 0.008, release = 0.05, harmonics, vibrato = 0,
    } = input;
    const voiceGain = gain * this.energyAt(start);
    const startIdx = Math.max(0, Math.floor(start * this.sampleRate));
    const len = Math.min(
      this.left.length - startIdx,
      Math.max(1, Math.floor(dur * this.sampleRate)),
    );
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    let phase = 0;

    for (let i = 0; i < len; i += 1) {
      const t = i / this.sampleRate;
      const progress = i / len;
      const atk = Math.min(1, t / Math.max(0.001, attack));
      const rel = Math.min(1, (dur - t) / Math.max(0.005, release));
      const env = Math.max(0, Math.min(atk, rel));
      const vib = 1 + vibrato * Math.sin(2 * Math.PI * 5.2 * t);
      phase += (2 * Math.PI * freq * vib) / this.sampleRate;
      let sample = 0;

      if (harmonics) {
        harmonics.forEach((amp, h) => {
          sample += amp * Math.sin(phase * (h + 1));
        });
      } else if (type === 'triangle') {
        sample = (2 / Math.PI) * Math.asin(Math.sin(phase));
      } else if (type === 'sawtooth') {
        // Band-limited additive sawtooth; the old raw phase ramp aliased
        // badly near Nyquist and was exaggerated by RIAA pre-emphasis.
        sample = 0;
        const harmonicsCount = Math.min(10, Math.floor((this.sampleRate * 0.42) / Math.max(20, freq)));
        for (let h = 1; h <= harmonicsCount; h += 1) {
          sample += Math.sin(phase * h) / h;
        }
        sample *= 0.62;
      } else if (type === 'square') {
        sample = Math.tanh(2.8 * Math.sin(phase)) * 0.7;
      } else if (type === 'rhodes') {
        sample =
          Math.sin(phase) +
          0.34 * Math.sin(2 * phase) * Math.exp(-3.2 * progress) +
          0.12 * Math.sin(3.01 * phase) * Math.exp(-5 * progress);
        sample *= 0.72 + 0.28 * Math.sin(2 * Math.PI * 4.5 * t);
      } else if (type === 'cello') {
        sample =
          0.72 * Math.sin(phase) +
          0.22 * Math.sin(2 * phase) +
          0.08 * Math.sin(3 * phase);
        sample *= 1 + 0.035 * Math.sin(2 * Math.PI * 5.4 * t);
      } else {
        sample = Math.sin(phase);
      }

      const v = voiceGain * env * sample;
      const idx = startIdx + i;
      this.left[idx] += v * panL;
      this.right[idx] += v * panR;
    }
  }

  addKick(start: number, gain = 0.9): void {
    const hitGain = gain * this.energyAt(start);
    const len = Math.floor(0.24 * this.sampleRate);
    const s0 = Math.floor(start * this.sampleRate);
    for (let i = 0; i < len && s0 + i < this.left.length; i += 1) {
      const t = i / this.sampleRate;
      const f = 42 + 115 * Math.exp(-t * 28);
      const env = Math.exp(-t * 10.5);
      const v = hitGain * env * Math.sin(2 * Math.PI * f * t);
      this.left[s0 + i] += v;
      this.right[s0 + i] += v;
    }
  }

  addSnare(start: number, gain = 0.42): void {
    const hitGain = gain * this.energyAt(start);
    const len = Math.floor(0.18 * this.sampleRate);
    const s0 = Math.floor(start * this.sampleRate);
    let prev = 0;
    for (let i = 0; i < len && s0 + i < this.left.length; i += 1) {
      const t = i / this.sampleRate;
      const noise = this.nextNoise();
      const hp = noise - prev;
      prev = noise * 0.72;
      const env = Math.exp(-t * 18);
      const tone = 0.25 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 24);
      const v = hitGain * env * (0.75 * hp + tone);
      this.left[s0 + i] += v * 0.92;
      this.right[s0 + i] += v;
    }
  }

  addHat(start: number, dur = 0.045, gain = 0.16, open = false): void {
    const hitGain = gain * this.energyAt(start);
    const len = Math.floor(dur * this.sampleRate);
    const s0 = Math.floor(start * this.sampleRate);
    let prev = 0;
    for (let i = 0; i < len && s0 + i < this.left.length; i += 1) {
      const t = i / this.sampleRate;
      const noise = this.nextNoise();
      const hp = noise - prev;
      prev = noise * 0.82;
      const env = Math.exp(-t * (open ? 7 : 42));
      const v = hitGain * env * hp;
      this.left[s0 + i] += v * 0.7;
      this.right[s0 + i] += v;
    }
  }

  finalize(style: MusicStyle): StereoResult {
    let peak = 0;
    for (let i = 0; i < this.left.length; i += 1) {
      // Gentle style-dependent bus compression.
      const threshold = style === 'rock' || style === 'electronic' || style === 'hiphop' ? 0.42 : 0.62;
      const compress = (x: number) =>
        Math.sign(x) * (threshold + (1 - threshold) * Math.tanh((Math.abs(x) - threshold) * 2.2));
      this.left[i] = compress(this.left[i]);
      this.right[i] = compress(this.right[i]);
      peak = Math.max(peak, Math.abs(this.left[i]), Math.abs(this.right[i]));
    }
    const target = style === 'classical' || style === 'jazz' ? 0.78 : 0.94;
    const norm = target / Math.max(peak, 0.001);
    let dcL = 0;
    let dcR = 0;
    for (let i = 0; i < this.left.length; i += 1) {
      // Short fade and normalization.
      const fade = Math.min(1, i / 2205, (this.left.length - i) / 4410);
      this.left[i] = Math.tanh(this.left[i] * norm * 1.08) * fade;
      this.right[i] = Math.tanh(this.right[i] * norm * 1.08) * fade;
      dcL += this.left[i];
      dcR += this.right[i];
    }
    dcL /= this.left.length;
    dcR /= this.right.length;
    for (let i = 0; i < this.left.length; i += 1) {
      this.left[i] -= dcL * (1 - i / this.left.length);
      this.right[i] -= dcR * (1 - i / this.right.length);
    }
    return { left: this.left, right: this.right };
  }
}

interface StereoResult {
  left: Float32Array;
  right: Float32Array;
}

const STYLE_META: Record<MusicStyle, Omit<MasterTrack, 'left' | 'right' | 'sampleRate' | 'durationSec'>> = {
  rock: {
    id: 'factory-rock',
    title: '冲床之夜',
    artist: '黑胶厂试音母带',
    style: 'rock',
    generated: true,
    description: '失真吉他与重型底鼓，专门考验低频摆幅和相邻沟槽碰撞。',
    bpm: 132,
  },
  jazz: {
    id: 'factory-jazz',
    title: '深夜三点的爵士棚',
    artist: '黑胶厂试音母带',
    style: 'jazz',
    generated: true,
    description: '摇摆 Ride 镲、立式贝斯与 Rhodes，动态温和、安静段落多。',
    bpm: 104,
  },
  classical: {
    id: 'factory-classical',
    title: '小调钢琴与大提琴片段',
    artist: '黑胶厂试音母带',
    style: 'classical',
    generated: true,
    description: '从极弱琶音到强奏齐奏，用来检查过浅沟槽和大动态变距。',
    bpm: 76,
  },
  electronic: {
    id: 'factory-electronic',
    title: '内圈霓虹',
    artist: '黑胶厂试音母带',
    style: 'electronic',
    generated: true,
    description: '深层侧链贝斯、十六分琶音和明亮踩镲，考验内圈高频跟踪。',
    bpm: 124,
  },
  hiphop: {
    id: 'factory-hiphop',
    title: '采样间的节拍',
    artist: '黑胶厂试音母带',
    style: 'hiphop',
    generated: true,
    description: 'Boom-bap 鼓组、低频贝斯与爵士和弦，中等响度和明显律动。',
    bpm: 88,
  },
};

function renderRock(r: MusicRenderer, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const roots = [40, 40, 43, 38];
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    const root = roots[Math.floor(b / 2) % roots.length];
    for (let q = 0; q < 4; q += 1) {
      if (q === 0 || q === 2) r.addKick(t0 + q * beat, 1.0);
      if (q === 1 || q === 3) r.addSnare(t0 + q * beat, 0.48);
    }
    for (let e = 0; e < 8; e += 1) {
      const t = t0 + (e * beat) / 2;
      r.addHat(t, 0.035, e % 2 ? 0.13 : 0.2);
      const note = root + (e === 6 ? 7 : 0);
      r.addTone({ start: t, dur: beat * 0.42, freq: midiToFreq(note - 12), gain: 0.34, type: 'triangle', pan: 0 });
      for (const interval of [0, 7, 12]) {
        r.addTone({
          start: t,
          dur: beat * 0.46,
          freq: midiToFreq(note + interval),
          gain: 0.105,
          type: 'sawtooth',
          pan: interval === 7 ? -0.55 : 0.5,
          attack: 0.004,
          release: 0.04,
        });
      }
    }
  }
}

function renderJazz(r: MusicRenderer, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const progression = [
    [50, 57, 60, 64],
    [47, 55, 59, 62],
    [45, 52, 57, 60],
    [48, 55, 59, 62],
  ];
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    const chord = progression[b % progression.length];
    for (let q = 0; q < 4; q += 1) {
      const swing = q % 2 === 0 ? 0 : beat * 0.08;
      r.addTone({ start: t0 + q * beat + swing, dur: beat * 0.9, freq: midiToFreq(chord[0] - 12 + [0, 7, 5, 3][q]), gain: 0.24, type: 'triangle', pan: -0.18, attack: 0.015 });
      if (q === 1 || q === 3) r.addHat(t0 + q * beat, 0.09, 0.08, true);
      // Ride pattern: ding, ding-a-ding.
      r.addHat(t0 + q * beat, 0.12, 0.07);
      r.addHat(t0 + q * beat + beat * 0.66, 0.06, 0.055);
    }
    if (b % 2 === 0) r.addKick(t0 + beat * 2.4, 0.34);
    chord.slice(1).forEach((note, i) => {
      r.addTone({
        start: t0 + beat * (i === 0 ? 0.5 : 1.5 + i * 0.55),
        dur: beat * 1.4,
        freq: midiToFreq(note + 12),
        gain: 0.115,
        type: 'rhodes',
        pan: i % 2 ? 0.42 : -0.38,
        attack: 0.012,
        release: 0.22,
      });
    });
  }
}

function renderClassical(r: MusicRenderer, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const chords = [
    [57, 60, 64],
    [55, 59, 62],
    [53, 57, 60],
    [55, 59, 64],
  ];
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    const strong = b >= bars - 6;
    const dynamic = strong ? 0.24 : 0.095 + 0.025 * Math.sin(b * 0.9);
    const chord = chords[b % chords.length];
    for (let a = 0; a < 8; a += 1) {
      const note = chord[a % chord.length] + (a > 4 ? 12 : 0);
      r.addTone({
        start: t0 + (a * beat) / 2,
        dur: beat * 0.9,
        freq: midiToFreq(note + 12),
        gain: dynamic,
        type: 'rhodes',
        pan: a % 2 ? 0.28 : -0.28,
        attack: 0.006,
        release: 0.28,
        harmonics: [1, 0.28, 0.11, 0.045],
      });
    }
    const melody = [chord[2] + 12, chord[1] + 12, chord[0] + 12, chord[2] + 24];
    melody.forEach((note, q) => {
      r.addTone({
        start: t0 + q * beat,
        dur: beat * (q === 3 ? 1.8 : 0.8),
        freq: midiToFreq(note),
        gain: strong ? 0.25 : 0.13,
        type: 'cello',
        pan: 0.12,
        attack: 0.09,
        release: 0.35,
        vibrato: 0.006,
      });
    });
    if (strong) r.addKick(t0, 0.28);
  }
}

function renderElectronic(r: MusicRenderer, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const roots = [36, 36, 39, 34];
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    const root = roots[Math.floor(b / 2) % roots.length];
    for (let q = 0; q < 4; q += 1) {
      r.addKick(t0 + q * beat, 0.92);
      r.addHat(t0 + q * beat + beat / 2, 0.05, 0.18);
    }
    for (let s = 0; s < 16; s += 1) {
      const t = t0 + (s * beat) / 4;
      if (s % 2 === 0) r.addHat(t, 0.025, s % 4 === 2 ? 0.16 : 0.08);
      const arpNote = root + 24 + [0, 7, 12, 15][s % 4];
      r.addTone({ start: t, dur: beat * 0.22, freq: midiToFreq(arpNote), gain: 0.11, type: 'square', pan: s % 2 ? 0.45 : -0.45, attack: 0.003, release: 0.03 });
      if (s % 4 === 0) {
        // Sidechain-style bass envelope ducked just after each kick.
        r.addTone({ start: t + 0.055, dur: beat * 0.72, freq: midiToFreq(root), gain: 0.42, type: 'triangle', pan: 0, attack: 0.012, release: 0.08 });
      }
    }
    [0, 3, 7].forEach((interval, i) => {
      r.addTone({ start: t0 + beat * 0.12, dur: bar * 0.72, freq: midiToFreq(root + 24 + interval), gain: 0.055, type: 'sawtooth', pan: i === 1 ? 0.5 : -0.42, attack: 0.18, release: 0.35 });
    });
  }
}

function renderHipHop(r: MusicRenderer, bars: number, bpm: number): void {
  const beat = 60 / bpm;
  const bar = beat * 4;
  for (let b = 0; b < bars; b += 1) {
    const t0 = b * bar;
    r.addKick(t0, 0.95);
    r.addKick(t0 + beat * 2.65, 0.72);
    r.addSnare(t0 + beat, 0.46);
    r.addSnare(t0 + beat * 3, 0.5);
    for (let h = 0; h < 8; h += 1) r.addHat(t0 + (h * beat) / 2, 0.04, h % 2 ? 0.1 : 0.16);
    const root = [38, 36, 41, 39][b % 4];
    r.addTone({ start: t0, dur: beat * 1.4, freq: midiToFreq(root), gain: 0.4, type: 'sine' });
    r.addTone({ start: t0 + beat * 2.5, dur: beat, freq: midiToFreq(root + 7), gain: 0.3, type: 'triangle' });
    [60, 64, 67, 71].forEach((note, i) => {
      r.addTone({ start: t0 + i * beat * 0.75, dur: beat * 1.2, freq: midiToFreq(note), gain: 0.09, type: 'rhodes', pan: i % 2 ? 0.35 : -0.35, release: 0.18 });
    });
  }
}

export function generateStyleTrack(style: MusicStyle, options: RenderOptions = {}): MasterTrack {
  const sampleRate = options.sampleRate ?? 44100;
  const durationSec = options.durationSec ?? 42;
  const seed = style.split('').reduce((a, c) => a + c.charCodeAt(0) * 17, 13);
  const renderer = new MusicRenderer(sampleRate, durationSec, seed, style);
  const bpm = STYLE_META[style].bpm;
  const barSec = (60 / bpm) * 4;
  const bars = Math.ceil(durationSec / barSec) + 1;

  if (style === 'rock') renderRock(renderer, bars, bpm);
  if (style === 'jazz') renderJazz(renderer, bars, bpm);
  if (style === 'classical') renderClassical(renderer, bars, bpm);
  if (style === 'electronic') renderElectronic(renderer, bars, bpm);
  if (style === 'hiphop') renderHipHop(renderer, bars, bpm);

  const { left, right } = renderer.finalize(style);
  return {
    ...STYLE_META[style],
    sampleRate,
    durationSec: left.length / sampleRate,
    left,
    right,
  };
}

export const STYLE_LIST: MusicStyle[] = ['rock', 'jazz', 'classical', 'electronic', 'hiphop'];

export function generateAllStyleTracks(durationSec = 30): MasterTrack[] {
  return STYLE_LIST.map((style) => generateStyleTrack(style, { durationSec }));
}
