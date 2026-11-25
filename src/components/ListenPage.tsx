import { useEffect, useRef, useState } from 'react';
import { PlaybackEngine, type AuditionMode } from '../audio/PlaybackEngine';
import { STYLE_LIST } from '../audio/generateMusic';
import { linearVelocityMmPerSec, radiusForTime, estimateTrackingThdPct } from '../audio/tracking';
import type { GrooveBuffer } from '../geometry/groove';
import type { GeometryConfig, MasterTrack, MusicStyle, PlanResult } from '../types';
import { formatTime } from './CanvasPlot';
import { ThdRadiusChart } from './charts';
import { Badge, SectionTitle, StatCard } from './ui';

const MODES: Array<{ id: AuditionMode; title: string; desc: string }> = [
  { id: 'original', title: '母带原声', desc: '绕过 RIAA 与唱针模型，用于 A/B 对比。' },
  { id: 'preemphasis', title: '仅 RIAA 预加重', desc: '听到刻片前的高频提升曲线。' },
  { id: 'needle', title: '唱针回放模拟', desc: 'RIAA 预加重 → Worklet 积分/45-45 → 针尖跟踪失真 → RIAA 去加重。' },
];

function SpectrumCanvas({ engine }: { engine: PlaybackEngine }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      const analyser = engine.getAnalyser();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(0, 0, w, h);
      if (!analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const bars = 72;
      const step = Math.floor(data.length / bars / 1.4);
      const barW = w / bars - 2;
      for (let i = 0; i < bars; i += 1) {
        const v = data[Math.floor(i * step * 1.35)] / 255;
        const bh = Math.max(2, v * h * 0.86);
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, '#62d6c8');
        grad.addColorStop(1, '#f2b84b');
        ctx.fillStyle = grad;
        ctx.fillRect(i * (barW + 2), h - bh, barW, bh);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return <canvas ref={ref} className="spectrum-canvas" aria-label="实时频谱" />;
}

export function ListenPage({
  track,
  groove,
  plan,
  config,
  onConfigChange,
  programPreview,
  previewStyle,
  onPreviewStyle,
}: {
  track: MasterTrack;
  groove: GrooveBuffer;
  plan: PlanResult;
  config: GeometryConfig;
  onConfigChange: (next: GeometryConfig) => void;
  programPreview: boolean;
  previewStyle: MusicStyle;
  onPreviewStyle: (style: MusicStyle) => void;
}) {
  const engineRef = useRef<PlaybackEngine | null>(null);
  if (!engineRef.current) engineRef.current = new PlaybackEngine();
  const engine = engineRef.current;

  const [mode, setMode] = useState<AuditionMode>('needle');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mix, setMix] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    engine.stop();
  }, [track.id, engine]);

  useEffect(() => {
    engine.configure({
      stylusRadiusMm: config.stylusRadiusMm,
      velocityGainMmPerSec: config.velocityGainMmPerSec,
      trackingMix: mix,
      dcServoHz: config.dcServoHz,
      verticalTrim: config.verticalTrim,
    });
  }, [config.stylusRadiusMm, config.velocityGainMmPerSec, config.dcServoHz, config.verticalTrim, mix, engine]);

  useEffect(() => () => { engine.pause(); }, [engine]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const t = engine.getCurrentTime();
      setTime(t);
      engine.setRadius(t);
      if (engine.isPlaying()) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, engine]);

  useEffect(() => {
    engine.onEnded(() => setPlaying(false));
  }, [engine]);

  const radius = radiusForTime(time, track.durationSec, plan.radiiMm);
  const velocity = linearVelocityMmPerSec(radius, config.rpm);
  const thd5k = estimateTrackingThdPct({
    radiusMm: radius,
    stylusRadiusMm: config.stylusRadiusMm,
    rpm: config.rpm,
  });
  const nearest = plan.metrics[Math.min(plan.metrics.length - 1, Math.floor((time / track.durationSec) * plan.metrics.length))];

  async function togglePlay(nextMode = mode) {
    setBusy(true);
    try {
      if (playing) {
        const t = engine.pause();
        setTime(t);
        setPlaying(false);
      } else {
        await engine.load(track, groove, plan);
        engine.configure({
          stylusRadiusMm: config.stylusRadiusMm,
          velocityGainMmPerSec: config.velocityGainMmPerSec,
          trackingMix: mix,
          dcServoHz: config.dcServoHz,
          verticalTrim: config.verticalTrim,
        });
        await engine.play(nextMode, time);
        setMode(nextMode);
        setPlaying(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeMode(next: AuditionMode) {
    setMode(next);
    if (playing) {
      setBusy(true);
      try {
        await engine.play(next, engine.getCurrentTime());
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {programPreview ? (
        <section className="panel">
          <SectionTitle
            title="22 分钟编程母带的可听预览"
            note="整面基准只保存圈级物理包络以保证性能；这里播放同一套合成器生成的同风格完整短片段，并把播放头映射到规划半径。"
            right={
              <select
                value={previewStyle}
                onChange={(e) => onPreviewStyle(e.target.value as MusicStyle)}
                style={{ background: '#11151d', color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: 10, padding: '8px 10px' }}
              >
                {STYLE_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            }
          />
        </section>
      ) : null}

      <section className="panel audio-player">
        <SectionTitle
          title="刻片师傅试听台"
          note="建议戴耳机或接监听音箱。可先听母带原声，再切换到唱针回放；内圈位置的高频泛音和互调失真会随半径变小而增强。"
          right={<Badge tone="good">Web Audio · AudioWorklet</Badge>}
        />

        <div className="mode-grid">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-button ${mode === m.id ? 'active' : ''}`} onClick={() => changeMode(m.id)}>
              <strong>{m.title}</strong>
              <span>{m.desc}</span>
            </button>
          ))}
        </div>

        <SpectrumCanvas engine={engine} />

        <div className="transport">
          <button className="play-button" onClick={() => void togglePlay()} disabled={busy} aria-label={playing ? '暂停' : '播放'}>
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <span className="time">{formatTime(time)} / {formatTime(track.durationSec)}</span>
          <input
            className="progress"
            type="range"
            min={0}
            max={Math.max(0.1, track.durationSec)}
            step={0.01}
            value={time}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTime(v);
              engine.seek(v);
            }}
          />
          <button className="button small" onClick={() => { engine.stop(); setPlaying(false); setTime(0); }}>停止</button>
        </div>

        <div className="controls">
          <div className="control">
            <label><span>针尖半径</span><output>{(config.stylusRadiusMm * 1000).toFixed(1)} µm</output></label>
            <input
              type="range" min={0.005} max={0.04} step={0.0005}
              value={config.stylusRadiusMm}
              onChange={(e) => onConfigChange({ ...config, stylusRadiusMm: Number(e.target.value) })}
            />
          </div>
          <div className="control">
            <label><span>跟踪失真混合量</span><output>{Math.round(mix * 100)}%</output></label>
            <input type="range" min={0} max={1} step={0.01} value={mix} onChange={(e) => setMix(Number(e.target.value))} />
          </div>
        </div>
      </section>

      <div className="grid cols-4">
        <StatCard label="当前映射半径" value={radius.toFixed(1)} unit="mm" tone={radius < 80 ? 'warn' : 'teal'} />
        <StatCard label="线性速度" value={velocity.toFixed(0)} unit="mm/s" foot="v = ωr；内圈高频波长更短" />
        <StatCard label="5 kHz 参考 THD" value={thd5k.toFixed(2)} unit="%" tone={thd5k > 6 ? 'bad' : 'warn'} foot="有限针尖几何跟踪估算" />
        <StatCard label="本圈母带估算 THD" value={(nearest?.maxTrackingThdPct ?? 0).toFixed(2)} unit="%" foot={`第 ${(nearest?.index ?? 0) + 1} 圈，按实际峰值/斜率`} />
      </div>

      <div className="eq-grid">
        <section className="panel">
          <SectionTitle title="半径 — 跟踪失真曲线" note="同一频率和针尖半径下，半径越小，线速度越低，空间斜率越大，失真单调上升。青色点为当前母带各圈实际估算。" />
          <ThdRadiusChart config={config} plan={plan} />
        </section>
        <section className="panel">
          <SectionTitle title="实时信号链" />
          <div className="formula">
{`AudioBuffer（L/R 母带）
  ↓ IIR RIAA pre-emphasis（同一采样率系数）
  ↓ AudioWorklet：速度积分 → 45/45 横向/纵向
  ↓ slope = dx/dt / (ω_disc · r)
  ↓ 针尖法向偏移 + 接触项
  ↓ 微分回放为唱头速度，还原 L/R
IIR RIAA de-emphasis（同采样率精确抵消）
  ↓ 压缩保护 / AnalyserNode
扬声器`}
          </div>
          <p className="small-text section-space">
            Worklet 文件位于 <code>public/worklets/tracking-processor.js</code>；TypeScript 中保留同方程孪生模型用于图表和自动化测试。
          </p>
        </section>
      </div>
    </div>
  );
}
