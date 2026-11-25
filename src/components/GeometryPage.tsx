import { useState } from 'react';
import type { GrooveBuffer } from '../geometry/groove';
import type { GeometryConfig, MasterTrack, PlanResult } from '../types';
import { GrooveCloseup, DiscMap, RiaaChart } from './charts';
import { Badge, SectionTitle, StatCard } from './ui';

export function GeometryPage({
  track,
  groove,
  plan,
  config,
}: {
  track: MasterTrack | null;
  groove: GrooveBuffer | null;
  plan: PlanResult;
  config: GeometryConfig;
}) {
  const [focusRev, setFocusRev] = useState(() => Math.floor(plan.revolutionCount * 0.55));
  const safeFocus = Math.min(focusRev, Math.max(0, plan.revolutionCount - 2));
  const maxLat = Math.max(...plan.metrics.map((m) => m.lateralPeakMm));
  const maxVert = Math.max(...plan.metrics.map((m) => m.verticalPeakMm));
  const minDepth = Math.min(...plan.metrics.map((m) => m.depthMinMm));
  const liftCount = plan.warnings.filter((w) => w.kind === 'lift').length;
  const shallowCount = plan.warnings.filter((w) => w.kind === 'shallow').length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-4">
        <StatCard label="最大横向摆动" value={(maxLat * 1000).toFixed(1)} unit="µm" tone="amber" foot="由 L+R 与低频积分位移形成" />
        <StatCard label="最大纵向摆动" value={(maxVert * 1000).toFixed(1)} unit="µm" tone="teal" foot="由 L−R 与纵向修剪形成" />
        <StatCard
          label="最小刻槽深度"
          value={(minDepth * 1000).toFixed(1)}
          unit="µm"
          tone={minDepth <= 0.0015 ? 'bad' : minDepth < config.shallowWarnMm ? 'warn' : 'good'}
          foot={`浅槽 ${shallowCount} 圈 · 抬刀 ${liftCount} 圈`}
        />
        <StatCard
          label="相邻沟槽校验"
          value={plan.collision.collisions === 0 ? '0 相交' : String(plan.collision.collisions)}
          tone={plan.collision.collisions === 0 ? 'good' : 'bad'}
          foot={`检查 ${plan.collision.checkedPairs} 对；最小间隙 ${(plan.collision.minClearanceMm * 1000).toFixed(1)} µm`}
        />
      </div>

      <section className="panel">
        <SectionTitle
          title="立体声到 45/45 沟槽运动"
          note="左右声道先做 RIAA 预加重，再把刻片头速度指令积分为物理位移；L+R 是横向摆动，L−R 是纵向摆动。槽宽随深度和刻刀夹角变化。"
          right={<Badge tone={config.riaaEnabled ? 'good' : 'warn'}>{config.riaaEnabled ? 'RIAA 已接入' : 'RIAA 已旁路'}</Badge>}
        />
        <div className="formula">
{`pre_L = RIAA_pre(L),  pre_R = RIAA_pre(R)
x_L(t) = leaky_integrate(pre_L · v_gain / f_s)
x_R(t) = leaky_integrate(pre_R · v_gain / f_s)
横向 x = (x_L + x_R) / √2
纵向 z = trim · (x_L − x_R) / √2
槽深 d = d₀ − z；半槽宽 w = k + max(d,0) · tan(θ/2)
相邻圈需求 pᵢ ≥ max|xᵢ|+wᵢ + max|xᵢ₊₁|+wᵢ₊₁ + safety`}
        </div>
      </section>

      <div className="two-col-wide">
        <section className="panel">
          <SectionTitle
            title="相邻沟槽几何放大"
            note={groove ? '按真实采样绘制槽壁；纵向毫米比例已放大。' : '22 分钟编程母带未保存全量采样，下图使用每圈保守峰值重建示意。'}
            right={
              <label className="toggle-row">
                聚焦圈
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, plan.revolutionCount - 2)}
                  value={safeFocus}
                  onChange={(e) => setFocusRev(Number(e.target.value))}
                  style={{ width: 150 }}
                />
                <output>{safeFocus + 1}</output>
              </label>
            }
          />
          <GrooveCloseup groove={groove} plan={plan} focusRev={safeFocus} />
        </section>

        <section className="panel">
          <SectionTitle title="整面俯视" note="颜色越暖表示该圈进给越大；红点表示抬刀风险。" />
          <DiscMap plan={plan} />
        </section>
      </div>

      <section className="panel">
        <SectionTitle
          title="RIAA 频响与预/去加重抵消"
          note="预加重和 AudioWorklet 之后的 IIR 去加重使用同一组双线性变换系数；测试覆盖 20 Hz–20 kHz。"
          right={<Badge tone="good">级联误差 &lt; 0.5 dB</Badge>}
        />
        <RiaaChart sampleRate={track?.sampleRate ?? 44100} />
      </section>
    </div>
  );
}
