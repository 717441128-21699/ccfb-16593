// RIAA time constants. The pre-emphasis inverse has an ideal zero-only
// ultrasonic section; a real cutter head rolls off there. Add a 400 kHz
// stabilizing pole so the bilinear transform does not place a marginally
// unstable pole at Nyquist. Its error through 20 kHz stays below 0.5 dB.
export const RIAA_TAU = {
  t1: 3180e-6,
  t2: 318e-6,
  t3: 75e-6,
  hfPole: 1 / (2 * Math.PI * 400_000),
  referenceHz: 1000,
} as const;

function magnitudeUnscaledDe(w: number): number {
  const num = Math.hypot(1, w * RIAA_TAU.t2);
  const den1 = Math.hypot(1, w * RIAA_TAU.t1);
  const den2 = Math.hypot(1, w * RIAA_TAU.t3);
  return num / (den1 * den2);
}

export function riaaDeEmphasisDb(freqHz: number): number {
  const w = 2 * Math.PI * freqHz;
  const wRef = 2 * Math.PI * RIAA_TAU.referenceHz;
  return 20 * Math.log10(magnitudeUnscaledDe(w) / magnitudeUnscaledDe(wRef));
}

export function riaaPreEmphasisDb(freqHz: number): number {
  return -riaaDeEmphasisDb(freqHz);
}

export interface FirstOrderCoefficients {
  b0: number;
  b1: number;
  a1: number;
}

export function bilinearFirstOrder(
  tauZero: number,
  tauPole: number,
  gain: number,
  sampleRate: number,
): FirstOrderCoefficients {
  const k = 2 * sampleRate;
  const az = 1 + tauZero * k;
  const bz = 1 - tauZero * k;
  const ap = 1 + tauPole * k;
  const bp = 1 - tauPole * k;
  return {
    b0: (gain * az) / ap,
    b1: (gain * bz) / ap,
    a1: bp / ap,
  };
}

export class FirstOrderFilter {
  private x1 = 0;
  private y1 = 0;
  constructor(private readonly c: FirstOrderCoefficients) {}

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
  }

  process(input: number): number {
    const y = this.c.b0 * input + this.c.b1 * this.x1 - this.c.a1 * this.y1;
    this.x1 = input;
    this.y1 = y;
    return y;
  }

  response(freqHz: number, sampleRate: number): { re: number; im: number } {
    const theta = (2 * Math.PI * freqHz) / sampleRate;
    const zRe = Math.cos(theta);
    const zIm = Math.sin(theta);
    // H = (b0 + b1 z^-1)/(1 + a1 z^-1), with y[n]=b0x+b1x1-a1*y1.
    const invRe = zRe;
    const invIm = -zIm;
    const numRe = this.c.b0 + this.c.b1 * invRe;
    const numIm = this.c.b1 * invIm;
    const denRe = 1 + this.c.a1 * invRe;
    const denIm = this.c.a1 * invIm;
    const denMag2 = denRe * denRe + denIm * denIm;
    return {
      re: (numRe * denRe + numIm * denIm) / denMag2,
      im: (numIm * denRe - numRe * denIm) / denMag2,
    };
  }
}

export class RiaaFilter {
  readonly sections: FirstOrderFilter[];
  readonly coefficients: FirstOrderCoefficients[];

  constructor(
    sampleRate: number,
    direction: 'pre' | 'de',
    private readonly channels = 2,
  ) {
    const wRef = 2 * Math.PI * RIAA_TAU.referenceHz;
    const deRefMag = magnitudeUnscaledDe(wRef);
    let specs: Array<{ z: number; p: number; g: number }>;

    if (direction === 'de') {
      const gDe = 1 / deRefMag;
      specs = [
        { z: RIAA_TAU.t2, p: RIAA_TAU.t1, g: gDe },
        { z: 0, p: RIAA_TAU.t3, g: 1 },
      ];
    } else {
      const gPre = deRefMag;
      specs = [
        { z: RIAA_TAU.t1, p: RIAA_TAU.t2, g: gPre },
        { z: RIAA_TAU.t3, p: RIAA_TAU.hfPole, g: 1 },
      ];
    }

    this.coefficients = specs.map((s) =>
      bilinearFirstOrder(s.z, s.p, s.g, sampleRate),
    );
    // One state set per channel; process sample interleaved through processSample.
    this.sections = Array.from(
      { length: this.channels * this.coefficients.length },
      () => new FirstOrderFilter({ b0: 1, b1: 0, a1: 0 }),
    );
    this.coefficients.forEach((c, section) => {
      for (let ch = 0; ch < channels; ch += 1) {
        this.sections[section * channels + ch] = new FirstOrderFilter(c);
      }
    });
  }

  processSample(sample: number, channel: number): number {
    let value = sample;
    for (let s = 0; s < this.coefficients.length; s += 1) {
      value = this.sections[s * this.channels + channel].process(value);
    }
    return value;
  }

  processBuffer(left: Float32Array, right?: Float32Array): {
    left: Float32Array;
    right: Float32Array;
  } {
    const outL = new Float32Array(left.length);
    const outR = new Float32Array(left.length);
    for (let i = 0; i < left.length; i += 1) {
      outL[i] = this.processSample(left[i], 0);
      outR[i] = this.processSample(right ? right[i] : left[i], right ? 1 : 0);
    }
    return { left: outL, right: outR };
  }

  magnitudeDb(freqHz: number, sampleRate: number): number {
    let re = 1;
    let im = 0;
    for (const c of this.coefficients) {
      const section = new FirstOrderFilter(c);
      const h = section.response(freqHz, sampleRate);
      const nextRe = re * h.re - im * h.im;
      const nextIm = re * h.im + im * h.re;
      re = nextRe;
      im = nextIm;
    }
    return 20 * Math.log10(Math.max(1e-12, Math.hypot(re, im)));
  }
}

export function riaaCascadeErrorDb(
  sampleRate: number,
  frequencies: number[],
): Array<{ freq: number; errorDb: number }> {
  const pre = new RiaaFilter(sampleRate, 'pre');
  const de = new RiaaFilter(sampleRate, 'de');
  return frequencies.map((freq) => {
    const errorDb = pre.magnitudeDb(freq, sampleRate) + de.magnitudeDb(freq, sampleRate);
    return { freq, errorDb };
  });
}
