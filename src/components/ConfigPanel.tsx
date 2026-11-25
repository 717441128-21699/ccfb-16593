import type { GeometryConfig } from '../types';

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="control">
      <label>
        <span>{label}</span>
        <output>{format ? format(value) : value.toFixed(3)}{unit ? ` ${unit}` : ''}</output>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ConfigPanel({
  config,
  onChange,
}: {
  config: GeometryConfig;
  onChange: (next: GeometryConfig) => void;
}) {
  const set = <K extends keyof GeometryConfig>(key: K, value: GeometryConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>刻片与唱针参数</h2>
          <p className="panel-note">修改后 TypeScript 几何与变距规划会立即重算；试听 Worklet 会读取针尖半径。</p>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.riaaEnabled}
            onChange={(e) => set('riaaEnabled', e.target.checked)}
          />
          RIAA 预加重
        </label>
      </div>
      <div className="controls">
        <Slider label="最外刻纹半径" value={config.outerRadiusMm} min={135} max={150} step={0.5} unit="mm" onChange={(v) => set('outerRadiusMm', v)} format={(v) => v.toFixed(1)} />
        <Slider label="内圈终止半径" value={config.innerLimitMm} min={50} max={68} step={0.5} unit="mm" onChange={(v) => set('innerLimitMm', v)} format={(v) => v.toFixed(1)} />
        <Slider label="最小圈距" value={config.minPitchMm} min={0.055} max={0.11} step={0.001} unit="mm" onChange={(v) => set('minPitchMm', v)} />
        <Slider label="固定圈距对照" value={config.fixedPitchMm} min={0.08} max={0.24} step={0.002} unit="mm" onChange={(v) => set('fixedPitchMm', v)} />
        <Slider label="安全间隙" value={config.safetyMm} min={0} max={0.015} step={0.001} unit="mm" onChange={(v) => set('safetyMm', v)} />
        <Slider label="刻刀速度增益" value={config.velocityGainMmPerSec} min={55} max={150} step={1} unit="mm/s" onChange={(v) => set('velocityGainMmPerSec', v)} format={(v) => v.toFixed(0)} />
        <Slider label="基础槽深" value={config.baseDepthMm} min={0.025} max={0.07} step={0.001} unit="mm" onChange={(v) => set('baseDepthMm', v)} />
        <Slider label="纵向摆幅修剪" value={config.verticalTrim} min={0.25} max={1} step={0.01} onChange={(v) => set('verticalTrim', v)} />
        <Slider label="唱针针尖半径" value={config.stylusRadiusMm} min={0.005} max={0.04} step={0.0005} unit="mm" onChange={(v) => set('stylusRadiusMm', v)} format={(v) => `${(v * 1000).toFixed(1)} µm`} />
      </div>
    </section>
  );
}
