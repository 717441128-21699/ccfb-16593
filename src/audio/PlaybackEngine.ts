import { RiaaFilter } from './riaa';
import { radiusForTime } from './tracking';
import type { GrooveBuffer } from '../geometry/groove';
import type { MasterTrack, PlanResult } from '../types';

export type AuditionMode = 'original' | 'preemphasis' | 'needle';

export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private deFilters: IIRFilterNode[] = [];
  private preFilters: IIRFilterNode[] = [];
  private workletReady: Promise<void> | null = null;
  private activeMode: AuditionMode = 'needle';
  private stylusRadiusMm = 0.0152;
  private velocityGainMmPerSec = 82;
  private dcServoHz = 18;
  private verticalTrim = 0.58;
  private trackingMix = 1;
  private track: MasterTrack | null = null;
  private groove: GrooveBuffer | null = null;
  private plan: PlanResult | null = null;
  private originalBuffer: AudioBuffer | null = null;
  private grooveBuffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private onEndedCallback: (() => void) | null = null;

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -10;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.18;
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.86;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.workletReady) {
      const url = `${import.meta.env.BASE_URL}worklets/tracking-processor.js`;
      this.workletReady = this.ctx.audioWorklet.addModule(url);
    }
    await this.workletReady;
    return this.ctx;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  onEnded(cb: () => void): void {
    this.onEndedCallback = cb;
  }

  async load(track: MasterTrack, groove: GrooveBuffer, plan: PlanResult): Promise<void> {
    const ctx = await this.ensureContext();
    this.stopSource(false);
    this.track = track;
    this.groove = groove;
    this.plan = plan;

    this.originalBuffer = ctx.createBuffer(2, track.left.length, track.sampleRate);
    this.originalBuffer.getChannelData(0).set(track.left);
    this.originalBuffer.getChannelData(1).set(track.right);

    this.grooveBuffer = ctx.createBuffer(2, groove.lateral.length, groove.sampleRate);
    this.grooveBuffer.getChannelData(0).set(groove.lateral);
    this.grooveBuffer.getChannelData(1).set(groove.vertical);

    const de = new RiaaFilter(ctx.sampleRate, 'de');
    const pre = new RiaaFilter(ctx.sampleRate, 'pre');
    this.deFilters = de.coefficients.map((c) =>
      ctx.createIIRFilter([c.b0, c.b1], [1, c.a1]),
    );
    this.preFilters = pre.coefficients.map((c) =>
      ctx.createIIRFilter([c.b0, c.b1], [1, c.a1]),
    );
  }

  private connectChain(nodes: AudioNode[], destination: AudioNode): void {
    for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(destination);
  }

  async play(mode: AuditionMode, offsetSec = this.offset): Promise<void> {
    if (!this.ctx || !this.track || !this.originalBuffer || !this.grooveBuffer) {
      if (this.track && this.groove && this.plan) await this.load(this.track, this.groove, this.plan);
    }
    const ctx = await this.ensureContext();
    if (!this.track || !this.originalBuffer || !this.grooveBuffer || !this.compressor) return;
    this.stopSource(false);
    this.activeMode = mode;
    this.offset = Math.max(0, Math.min(offsetSec, this.track.durationSec - 0.05));

    const source = ctx.createBufferSource();
    this.source = source;
    source.onended = () => {
      if (this.source === source && this.playing) {
        this.playing = false;
        this.offset = this.track?.durationSec ?? 0;
        this.onEndedCallback?.();
      }
    };

    if (mode === 'original') {
      source.buffer = this.originalBuffer;
      source.connect(this.compressor);
    } else if (mode === 'preemphasis') {
      source.buffer = this.originalBuffer;
      this.connectChain([source, ...this.preFilters], this.compressor);
    } else {
      source.buffer = this.originalBuffer;
      const worklet = new AudioWorkletNode(ctx, 'needle-tracking-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        parameterData: {
          radiusMm: this.currentRadius(this.offset),
          stylusRadiusMm: this.stylusRadiusMm,
          velocityGainMmPerSec: this.velocityGainMmPerSec,
          trackingMix: this.trackingMix,
          inputIsVelocity: 1,
          dcServoHz: this.dcServoHz,
          verticalTrim: this.verticalTrim,
        },
      });
      this.worklet = worklet;
      this.connectChain(
        [source, ...this.preFilters, worklet, ...this.deFilters],
        this.compressor,
      );
    }

    this.startedAt = ctx.currentTime;
    this.playing = true;
    source.start(0, this.offset);
    this.setRadius(this.offset);
  }

  private currentRadius(time: number): number {
    if (!this.plan) return 110;
    return radiusForTime(time, this.track?.durationSec ?? this.plan.durationSec, this.plan.radiiMm);
  }

  setRadius(time: number): void {
    if (!this.ctx || !this.worklet) return;
    const radius = this.currentRadius(time);
    const param = this.worklet.parameters.get('radiusMm');
    if (param) param.setTargetAtTime(radius, this.ctx.currentTime, 0.03);
  }

  configure(params: {
    stylusRadiusMm?: number;
    velocityGainMmPerSec?: number;
    trackingMix?: number;
    dcServoHz?: number;
    verticalTrim?: number;
  }): void {
    if (params.stylusRadiusMm !== undefined) this.stylusRadiusMm = params.stylusRadiusMm;
    if (params.velocityGainMmPerSec !== undefined) this.velocityGainMmPerSec = params.velocityGainMmPerSec;
    if (params.trackingMix !== undefined) this.trackingMix = params.trackingMix;
    if (params.dcServoHz !== undefined) this.dcServoHz = params.dcServoHz;
    if (params.verticalTrim !== undefined) this.verticalTrim = params.verticalTrim;
    if (this.worklet && this.ctx) {
      const now = this.ctx.currentTime;
      const set = (name: string, value: number | undefined) => {
        if (value === undefined) return;
        this.worklet?.parameters.get(name)?.setTargetAtTime(value, now, 0.02);
      };
      set('stylusRadiusMm', params.stylusRadiusMm);
      set('velocityGainMmPerSec', params.velocityGainMmPerSec);
      set('trackingMix', params.trackingMix);
      set('dcServoHz', params.dcServoHz);
      set('verticalTrim', params.verticalTrim);
    }
  }

  seek(timeSec: number): void {
    const wasPlaying = this.playing;
    const mode = this.activeMode;
    this.offset = Math.max(0, Math.min(timeSec, this.track?.durationSec ?? 0));
    if (wasPlaying) void this.play(mode, this.offset);
  }

  setStaticOffset(timeSec: number): void {
    if (!this.playing) this.offset = Math.max(0, Math.min(timeSec, this.track?.durationSec ?? 0));
  }

  pause(): number {
    if (!this.ctx || !this.playing) return this.offset;
    this.offset = this.getCurrentTime();
    this.stopSource(false);
    return this.offset;
  }

  stop(): void {
    this.offset = 0;
    this.stopSource();
  }

  private stopSource(resetOffset = true): void {
    this.playing = false;
    if (this.source) {
      const s = this.source;
      s.onended = null;
      try { s.stop(); } catch { /* already stopped */ }
      s.disconnect();
      this.source = null;
    }
    if (this.worklet) {
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.deFilters.forEach((f) => f.disconnect());
    this.preFilters.forEach((f) => f.disconnect());
    if (resetOffset) this.offset = 0;
  }

  getCurrentTime(): number {
    if (!this.ctx || !this.playing) return this.offset;
    return Math.min(
      this.track?.durationSec ?? 0,
      this.offset + (this.ctx.currentTime - this.startedAt),
    );
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getMode(): AuditionMode {
    return this.activeMode;
  }

  async dispose(): Promise<void> {
    this.stopSource();
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
  }
}
