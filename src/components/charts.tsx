import { useMemo } from 'react';
import { CanvasPlot } from './CanvasPlot';
import {
  RiaaFilter,
  riaaDeEmphasisDb,
  riaaPreEmphasisDb,
} from '../audio/riaa';
import { estimateTrackingThdPct } from '../audio/tracking';
import type { GrooveBuffer } from '../geometry/groove';
import type { GeometryConfig, MasterTrack, PlanResult } from '../types';

const COLORS = {
  amber: '#f2b84b',
  amberSoft: 'rgba(242,184,75,.22)',
  teal: '#62d6c8',
  tealSoft: 'rgba(98,214,200,.18)',
  red: '#ff6b5f',
  green: '#79d28f',
  blue: '#7aa7ff',
  grid: 'rgba(255,255,255,.075)',
  text: '#9aa4b8',
};

export function WaveformCanvas({ track }: { track: MasterTrack }) {
  return (
    <CanvasPlot
      className="waveform-canvas"
      ariaLabel="母带立体声波形"
      dependencies={[track.id, track.left.length]}
      draw={(ctx, w, h) => {
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        ctx.fillRect(0, 0, w, h);
        const mid = h / 2;
        ctx.strokeStyle = COLORS.grid;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.stroke();

        const drawChannel = (data: Float32Array, center: number, color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const bucket = data.length / w;
          for (let x = 0; x < w; x += 1) {
            const start = Math.floor(x * bucket);
            const end = Math.max(start + 1, Math.floor((x + 1) * bucket));
            let min = 0;
            let max = 0;
            for (let i = start; i < end && i < data.length; i += 4) {
              const v = data[i];
              if (v < min) min = v;
              if (v > max) max = v;
            }
            const y1 = center - max * h * 0.38;
            const y2 = center - min * h * 0.38;
            ctx.moveTo(x + 0.5, y1);
            ctx.lineTo(x + 0.5, y2);
          }
          ctx.stroke();
        };
        drawChannel(track.left, h * 0.27, COLORS.amber);
        drawChannel(track.right, h * 0.73, COLORS.teal);

        ctx.fillStyle = COLORS.text;
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText('L', 10, 16);
        ctx.fillText('R', 10, h / 2 + 16);
      }}
    />
  );
}

export function RiaaChart({ sampleRate = 44100 }: { sampleRate?: number }) {
  const cascadeMax = useMemo(() => {
    const pre = new RiaaFilter(sampleRate, 'pre');
    const de = new RiaaFilter(sampleRate, 'de');
    let max = 0;
    for (let i = 0; i <= 200; i += 1) {
      const f = 20 * Math.pow(1000, i / 200);
      max = Math.max(max, Math.abs(pre.magnitudeDb(f, sampleRate) + de.magnitudeDb(f, sampleRate)));
    }
    return max;
  }, [sampleRate]);

  return (
    <CanvasPlot
      className="pitch-canvas"
      ariaLabel="RIAA 预加重、去加重和叠加误差曲线"
      dependencies={[sampleRate]}
      draw={(ctx, w, h) => {
        const pad = { l: 46, r: 14, t: 18, b: 30 };
        const iw = w - pad.l - pad.r;
        const ih = h - pad.t - pad.b;
        const fMin = 20;
        const fMax = 20000;
        const dbMin = -24;
        const dbMax = 24;
        const x = (f: number) => pad.l + (Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin)) * iw;
        const y = (db: number) => pad.t + (dbMax - db) / (dbMax - dbMin) * ih;

        ctx.strokeStyle = COLORS.grid;
        ctx.fillStyle = COLORS.text;
        ctx.font = '10px ui-monospace, monospace';
        [100, 1000, 10000].forEach((f) => {
          ctx.beginPath();
          ctx.moveTo(x(f), pad.t);
          ctx.lineTo(x(f), pad.t + ih);
          ctx.stroke();
          ctx.fillText(`${f >= 1000 ? f / 1000 + 'k' : f}`, x(f) - 8, h - 10);
        });
        [-20, -10, 0, 10, 20].forEach((db) => {
          ctx.beginPath();
          ctx.moveTo(pad.l, y(db));
          ctx.lineTo(pad.l + iw, y(db));
          ctx.stroke();
          ctx.fillText(`${db}`, 16, y(db) + 3);
        });

        const drawLine = (fn: (f: number) => number, color: string, width = 2) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let i = 0; i <= 240; i += 1) {
            const f = fMin * Math.pow(fMax / fMin, i / 240);
            const px = x(f);
            const py = y(fn(f));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        };
        drawLine(riaaPreEmphasisDb, COLORS.amber);
        drawLine(riaaDeEmphasisDb, COLORS.teal);
        drawLine((f) => {
          const pre = new RiaaFilter(sampleRate, 'pre').magnitudeDb(f, sampleRate);
          const de = new RiaaFilter(sampleRate, 'de').magnitudeDb(f, sampleRate);
          return (pre + de) * 12; // magnified 12x so the residual is visible
        }, COLORS.green, 2.5);

        ctx.font = '12px system-ui';
        ctx.fillStyle = COLORS.amber;
        ctx.fillText('预加重', pad.l + 8, 16);
        ctx.fillStyle = COLORS.teal;
        ctx.fillText('回放去加重', pad.l + 78, 16);
        ctx.fillStyle = COLORS.green;
        ctx.fillText(`叠加误差 ×12 放大显示；最大 ${cascadeMax.toExponential(2)} dB`, pad.l + 170, 16);
      }}
    />
  );
}

export function PitchChart({ plan }: { plan: PlanResult }) {
  return (
    <CanvasPlot
      className="pitch-canvas"
      ariaLabel="每一圈变距规划"
      dependencies={[plan.revolutionCount, plan.planningMs, plan.fixedSafePitchMm]}
      draw={(ctx, w, h) => {
        const pad = { l: 52, r: 16, t: 24, b: 34 };
        const iw = w - pad.l - pad.r;
        const ih = h - pad.t - pad.b;
        const pitches = plan.feedsMm;
        const maxP = Math.max(plan.fixedSafePitchMm * 1.08, ...pitches) * 1.08;
        const minP = 0.06;
        const x = (i: number) => pad.l + (i / Math.max(1, pitches.length - 1)) * iw;
        const y = (p: number) => pad.t + ih - ((p - minP) / (maxP - minP)) * ih;

        ctx.fillStyle = COLORS.text;
        ctx.font = '10px ui-monospace, monospace';
        for (let k = 0; k <= 4; k += 1) {
          const p = minP + ((maxP - minP) * k) / 4;
          ctx.strokeStyle = COLORS.grid;
          ctx.beginPath();
          ctx.moveTo(pad.l, y(p));
          ctx.lineTo(pad.l + iw, y(p));
          ctx.stroke();
          ctx.fillText(p.toFixed(3), 12, y(p) + 3);
        }

        const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
        grad.addColorStop(0, 'rgba(242,184,75,.42)');
        grad.addColorStop(1, 'rgba(242,184,75,.02)');
        ctx.beginPath();
        ctx.moveTo(x(0), y(pitches[0]));
        pitches.forEach((p, i) => ctx.lineTo(x(i), y(p)));
        ctx.lineTo(x(pitches.length - 1), pad.t + ih);
        ctx.lineTo(x(0), pad.t + ih);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = COLORS.amber;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        pitches.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p)) : ctx.lineTo(x(i), y(p))));
        ctx.stroke();

        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pad.l, y(plan.fixedSafePitchMm));
        ctx.lineTo(pad.l + iw, y(plan.fixedSafePitchMm));
        ctx.stroke();

        ctx.strokeStyle = COLORS.blue;
        ctx.beginPath();
        ctx.moveTo(pad.l, y(plan.fixedUserPitchMm));
        ctx.lineTo(pad.l + iw, y(plan.fixedUserPitchMm));
        ctx.stroke();
        ctx.setLineDash([]);

        plan.metrics.forEach((m) => {
          if (!m.lift && !m.shallow) return;
          ctx.fillStyle = m.lift ? COLORS.red : COLORS.amber;
          const px = x(m.index);
          ctx.fillRect(px - 0.5, pad.t, Math.max(1, iw / pitches.length), ih);
        });

        ctx.font = '12px system-ui';
        ctx.fillStyle = COLORS.amber;
        ctx.fillText('变距圈距', pad.l + 4, 16);
        ctx.fillStyle = COLORS.red;
        ctx.fillText('整面安全固定圈距', pad.l + 78, 16);
        ctx.fillStyle = COLORS.blue;
        ctx.fillText('当前固定圈距', pad.l + 210, 16);
        ctx.fillStyle = COLORS.text;
        ctx.fillText('圈序 →', pad.l + iw - 42, h - 10);
        ctx.save();
        ctx.translate(13, pad.t + ih / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('mm / 圈', 0, 0);
        ctx.restore();
      }}
    />
  );
}

export function ThdRadiusChart({ config, plan }: { config: GeometryConfig; plan?: PlanResult }) {
  return (
    <CanvasPlot
      className="pitch-canvas"
      ariaLabel="针尖跟踪失真随半径变化"
      dependencies={[config.stylusRadiusMm, plan?.revolutionCount]}
      draw={(ctx, w, h) => {
        const pad = { l: 48, r: 18, t: 24, b: 34 };
        const iw = w - pad.l - pad.r;
        const ih = h - pad.t - pad.b;
        const rMin = 52;
        const rMax = 148;
        const thdMax = 18;
        const x = (r: number) => pad.l + ((rMax - r) / (rMax - rMin)) * iw;
        const y = (v: number) => pad.t + ih - (Math.min(thdMax, v) / thdMax) * ih;
        ctx.strokeStyle = COLORS.grid;
        ctx.fillStyle = COLORS.text;
        ctx.font = '10px ui-monospace, monospace';
        [60, 80, 100, 120, 140].forEach((r) => {
          ctx.beginPath(); ctx.moveTo(x(r), pad.t); ctx.lineTo(x(r), pad.t + ih); ctx.stroke();
          ctx.fillText(`${r}`, x(r) - 8, h - 12);
        });
        [0, 4, 8, 12, 16].forEach((v) => {
          ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(pad.l + iw, y(v)); ctx.stroke();
          ctx.fillText(`${v}%`, 12, y(v) + 3);
        });
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i <= 160; i += 1) {
          const r = rMax - ((rMax - rMin) * i) / 160;
          const thd = estimateTrackingThdPct({
            radiusMm: r,
            stylusRadiusMm: config.stylusRadiusMm,
            rpm: config.rpm,
          });
          if (i === 0) ctx.moveTo(x(r), y(thd));
          else ctx.lineTo(x(r), y(thd));
        }
        ctx.stroke();

        if (plan) {
          ctx.fillStyle = COLORS.teal;
          plan.metrics.forEach((m) => {
            if (m.index % 8 !== 0) return;
            ctx.beginPath();
            ctx.arc(x(m.endRadiusMm), y(m.maxTrackingThdPct), 2.2, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        ctx.font = '12px system-ui';
        ctx.fillStyle = COLORS.red;
        ctx.fillText('5 kHz 估算 THD', pad.l + 8, 16);
        if (plan) {
          ctx.fillStyle = COLORS.teal;
          ctx.fillText('本母带各圈估算点（抽样）', pad.l + 126, 16);
        }
        ctx.fillStyle = COLORS.text;
        ctx.fillText('内圈半径 mm →', pad.l + iw - 92, h - 10);
      }}
    />
  );
}

export function GrooveCloseup({
  groove,
  plan,
  focusRev,
}: {
  groove: GrooveBuffer | null;
  plan: PlanResult;
  focusRev: number;
}) {
  return (
    <CanvasPlot
      className="geometry-canvas"
      ariaLabel="相邻沟槽放大几何图"
      dependencies={[focusRev, groove?.lateral.length, plan.revolutionCount]}
      draw={(ctx, w, h) => {
        const i = Math.max(0, Math.min(plan.revolutionCount - 2, focusRev));
        const m0 = plan.metrics[i];
        const m1 = plan.metrics[i + 1];
        const bins = Math.min(900, w * 2);
        const reference = plan.radiiMm[i] + plan.feedsMm[i] * 0.55;
        const mmRange = Math.max(0.16, plan.feedsMm[i] * 2.5);
        const x = (b: number) => 18 + (b / bins) * (w - 36);
        const y = (r: number) => h / 2 + ((reference - r) / mmRange) * (h - 70);

        ctx.fillStyle = 'rgba(0,0,0,.2)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = COLORS.grid;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

        const drawTurn = (rev: number, color: string, fill: string) => {
          const upper: Array<[number, number]> = [];
          const lower: Array<[number, number]> = [];
          for (let b = 0; b <= bins; b += 1) {
            const frac = b / bins;
            let lat = 0;
            let hw = plan.metrics[rev]?.halfWidthMaxMm ?? 0.03;
            if (groove) {
              const spr = Math.floor(groove.sampleRate * 60 / plan.revolutionDurationSec);
              const idx = Math.min(groove.lateral.length - 1, Math.floor((rev + frac) * spr));
              lat = groove.lateral[idx] || 0;
              hw = groove.halfWidth[idx] || hw;
            } else {
              const peak = plan.metrics[rev]?.lateralPeakMm ?? 0.01;
              lat = peak * Math.sin(frac * Math.PI * 2 * (18 + (rev % 5) * 3) + rev);
            }
            const nominal = plan.radiiMm[rev] - plan.feedsMm[rev] * frac;
            const center = nominal + lat;
            upper.push([x(b), y(center + hw)]);
            lower.push([x(b), y(center - hw)]);
          }
          ctx.beginPath();
          upper.forEach(([px, py], idx) => (idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          for (let k = lower.length - 1; k >= 0; k -= 1) ctx.lineTo(lower[k][0], lower[k][1]);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          upper.forEach(([px, py], idx) => (idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.stroke();
          ctx.beginPath();
          lower.forEach(([px, py], idx) => (idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.stroke();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          for (let b = 0; b <= bins; b += 1) {
            const frac = b / bins;
            let lat = 0;
            if (groove) {
              const spr = Math.floor(groove.sampleRate * 60 / plan.revolutionDurationSec);
              lat = groove.lateral[Math.min(groove.lateral.length - 1, Math.floor((rev + frac) * spr))] || 0;
            } else {
              const peak = plan.metrics[rev]?.lateralPeakMm ?? 0.01;
              lat = peak * Math.sin(frac * Math.PI * 2 * (18 + (rev % 5) * 3) + rev);
            }
            const r = plan.radiiMm[rev] - plan.feedsMm[rev] * frac + lat;
            if (b === 0) ctx.moveTo(x(b), y(r)); else ctx.lineTo(x(b), y(r));
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        };

        drawTurn(i, COLORS.amber, COLORS.amberSoft);
        drawTurn(i + 1, COLORS.teal, COLORS.tealSoft);

        ctx.fillStyle = COLORS.text;
        ctx.font = '12px system-ui';
        ctx.fillText(`第 ${i + 1} 圈`, 16, 22);
        ctx.fillStyle = COLORS.amber;
        ctx.fillText('外沟槽壁', 72, 22);
        ctx.fillStyle = COLORS.teal;
        ctx.fillText(`第 ${i + 2} 圈 / 内沟槽壁`, 150, 22);
        ctx.fillStyle = plan.collision.minClearanceMm >= 0 ? COLORS.green : COLORS.red;
        ctx.fillText(
          `保守最小壁间间隙 ${(plan.collision.minClearanceMm * 1000).toFixed(1)} µm；规划圈距 ${(m0.pitchToNextMm * 1000).toFixed(1)} µm，下一圈进给 ${(m1.feedMm * 1000).toFixed(1)} µm`,
          16,
          h - 16,
        );
      }}
    />
  );
}

export function DiscMap({ plan }: { plan: PlanResult }) {
  return (
    <CanvasPlot
      className="geometry-canvas"
      ariaLabel="整面沟槽俯视规划图"
      dependencies={[plan.revolutionCount, plan.endRadiusMm]}
      draw={(ctx, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.min(w, h) * 0.43;
        const scale = maxR / plan.radiiMm[0];
        const mapR = (r: number) => r * scale;

        const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxR);
        bg.addColorStop(0, '#151923');
        bg.addColorStop(0.35, '#0b0e15');
        bg.addColorStop(1, '#05060a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.fill();

        const maxPitch = Math.max(...plan.feedsMm);
        const segments = 72;
        for (let i = 0; i < plan.revolutionCount; i += 1) {
          const t = i / Math.max(1, plan.revolutionCount - 1);
          const pitchHot = plan.feedsMm[i] / maxPitch;
          ctx.strokeStyle = plan.metrics[i]?.lift
            ? COLORS.red
            : `rgba(${Math.round(98 + pitchHot * 145)}, ${Math.round(214 - pitchHot * 70)}, ${Math.round(200 - pitchHot * 120)}, ${0.34 + 0.45 * pitchHot})`;
          ctx.lineWidth = t > 0.82 ? 1.15 : 0.8;
          ctx.beginPath();
          for (let s = 0; s <= segments; s += 1) {
            const u = s / segments;
            const angle = -Math.PI / 2 + (i + u) * Math.PI * 2;
            const r = mapR(plan.radiiMm[i] - plan.feedsMm[i] * u);
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        ctx.fillStyle = '#f2b84b';
        ctx.beginPath(); ctx.arc(cx, cy, mapR(52), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#17120a';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('LABEL', cx, cy + 4);
        ctx.textAlign = 'left';

        ctx.strokeStyle = 'rgba(255,255,255,.25)';
        ctx.beginPath(); ctx.arc(cx, cy, mapR(plan.radiiMm[0]), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = COLORS.text;
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(`外圆 ${plan.radiiMm[0].toFixed(1)} mm`, cx + maxR * 0.55, cy - maxR * 0.72);
        ctx.fillStyle = plan.fits ? COLORS.green : COLORS.red;
        ctx.fillText(`末圈 ${plan.endRadiusMm.toFixed(1)} mm`, cx + mapR(plan.endRadiusMm) * 0.68, cy + mapR(plan.endRadiusMm) * 0.68);
      }}
    />
  );
}
