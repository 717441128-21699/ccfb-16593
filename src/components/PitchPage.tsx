import type { GeometryConfig, PlanResult } from '../types';
import { formatTime } from './CanvasPlot';
import { PitchChart } from './charts';
import { ConfigPanel } from './ConfigPanel';
import { Badge, SectionTitle, StatCard } from './ui';

export function PitchPage({
  plan,
  config,
  onConfigChange,
}: {
  plan: PlanResult;
  config: GeometryConfig;
  onConfigChange: (next: GeometryConfig) => void;
}) {
  const dangerWarnings = plan.warnings.filter((w) => w.severity === 'danger');
  const warningWarnings = plan.warnings.filter((w) => w.severity === 'warning');
  const visibleWarnings = plan.warnings.slice(0, 80);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <ConfigPanel config={config} onChange={onConfigChange} />

      <div className="grid cols-4">
        <StatCard
          label="变距后整面时长"
          value={formatTime(plan.durationSec)}
          tone="teal"
          foot={`${plan.revolutionCount} 圈 × ${plan.revolutionDurationSec.toFixed(2)} 秒`}
        />
        <StatCard
          label="可刻时长容量"
          value={formatTime(plan.variableCapacitySec)}
          tone="good"
          foot={`按平均变距 ${plan.variableMeanPitchMm.toFixed(4)} mm/圈 推算满盘`}
        />
        <StatCard
          label="安全固定圈距容量"
          value={formatTime(plan.fixedSafeCapacitySec)}
          tone="warn"
          foot={`固定 ${plan.fixedSafePitchMm.toFixed(4)} mm/圈，按整面最响峰值取值`}
        />
        <StatCard
          label="容量提升"
          value={`${plan.capacityGainPct >= 0 ? '+' : ''}${plan.capacityGainPct.toFixed(0)}%`}
          tone={plan.capacityGainPct > 25 ? 'good' : 'warn'}
          foot={`规划耗时 ${plan.planningMs.toFixed(1)} ms`}
        />
      </div>

      <section className="panel">
        <SectionTitle
          title="圈距规划曲线"
          note="每个相邻圈需求取两圈保守摆幅与最大槽宽之和；螺旋在同角度的间距是两个相邻进给的线性混合，因此规划器同时抬高边界两侧进给，杜绝变速过渡段相交。"
          right={
            <div className="inline-stats">
              <Badge tone={plan.collision.collisions === 0 ? 'good' : 'bad'}>
                {plan.collision.collisions === 0 ? '相邻圈零相交' : `${plan.collision.collisions} 个相交`}
              </Badge>
              <Badge tone={plan.fits ? 'good' : 'bad'}>
                {plan.fits ? `末圈 ${plan.endRadiusMm.toFixed(1)} mm，可刻入` : `超出内圈 ${(config.innerLimitMm - plan.endRadiusMm).toFixed(1)} mm`}
              </Badge>
            </div>
          }
        />
        <PitchChart plan={plan} />
        <div className="grid cols-3 section-space">
          <StatCard label="径向占用" value={plan.totalRadialMm.toFixed(2)} unit="mm" foot={`可用 ${plan.availableRadialMm.toFixed(1)} mm`} />
          <StatCard label="当前固定圈距风险" value={String(plan.fixedUserCollisions)} unit="对" tone={plan.fixedUserCollisions ? 'bad' : 'good'} foot={`固定值 ${plan.fixedUserPitchMm.toFixed(3)} mm；小于整段需求的圈对`} />
          <StatCard label="最小校验间隙" value={(plan.collision.minClearanceMm * 1000).toFixed(1)} unit="µm" tone="good" foot="包含安全间隙与保守槽壁包络" />
        </div>
      </section>

      <div className="two-col-wide">
        <section className="panel">
          <SectionTitle title="逐圈规划表" note="可按右侧指标横向滚动；半径从外向内递减。" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>圈号</th><th>时间</th><th>半径 mm</th><th>进给 µm</th>
                  <th>横向 µm</th><th>纵向 µm</th><th>最小槽深 µm</th>
                  <th>THD %</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {plan.metrics.map((m) => (
                  <tr key={m.index}>
                    <td>#{m.index + 1}</td>
                    <td>{formatTime(m.t0)}</td>
                    <td>{m.endRadiusMm.toFixed(2)}</td>
                    <td>{(m.feedMm * 1000).toFixed(1)}</td>
                    <td>{(m.lateralPeakMm * 1000).toFixed(1)}</td>
                    <td>{(m.verticalPeakMm * 1000).toFixed(1)}</td>
                    <td style={{ color: m.lift ? 'var(--red)' : m.shallow ? 'var(--amber)' : undefined }}>
                      {(m.depthMinMm * 1000).toFixed(1)}
                    </td>
                    <td>{m.maxTrackingThdPct.toFixed(2)}</td>
                    <td>
                      {m.lift ? <Badge tone="bad">抬刀</Badge> : m.shallow ? <Badge tone="warn">浅槽</Badge> : <Badge tone="good">正常</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionTitle
            title="风险标记"
            note={`危险 ${dangerWarnings.length} 条，提示 ${warningWarnings.length} 条；图表中的异常圈也可在表中定位。`}
          />
          <div className="warning-list">
            {visibleWarnings.length === 0 ? (
              <div className="small-text">当前参数下没有浅槽、抬刀或内圈失真警告。</div>
            ) : visibleWarnings.map((w, idx) => (
              <div key={`${w.revolution}-${w.kind}-${idx}`} className={`warning-item ${w.severity}`}>
                <div className="warning-time">{formatTime(w.timeSec)}<br />#{w.revolution + 1}</div>
                <div>{w.message}</div>
              </div>
            ))}
            {plan.warnings.length > visibleWarnings.length ? (
              <div className="small-text">其余 {plan.warnings.length - visibleWarnings.length} 条已写入逐圈表。</div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
