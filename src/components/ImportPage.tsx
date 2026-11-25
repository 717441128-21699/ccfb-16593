import { useRef, useState } from 'react';
import { STYLE_LIST } from '../audio/generateMusic';
import { PROGRAM_22MIN_SEC, PROGRAM_22MIN_SECTIONS } from '../audio/longProgram';
import type { MasterTrack } from '../types';
import { formatTime } from './CanvasPlot';
import { WaveformCanvas } from './charts';
import { Badge, SectionTitle, StatCard } from './ui';

const STYLE_LABEL: Record<string, string> = {
  rock: '摇滚',
  jazz: '爵士',
  classical: '古典',
  electronic: '电子',
  hiphop: '嘻哈',
};

export function ImportPage({
  selectedId,
  track,
  isProgram22,
  loading,
  onSelectStyle,
  onSelectProgram,
  onImportFile,
}: {
  selectedId: string;
  track: MasterTrack | null;
  isProgram22: boolean;
  loading: boolean;
  onSelectStyle: (style: (typeof STYLE_LIST)[number]) => void;
  onSelectProgram: () => void;
  onImportFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="panel">
        <SectionTitle
          title="母带导入"
          note="导入未压限到失真的立体声 WAV / FLAC / MP3，或直接使用为验证算法而程序化编写的五种风格试音母带。所有几何计算均在浏览器本地完成。"
          right={<Badge tone="good"><span className="status-dot" />本地处理</Badge>}
        />
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onImportFile(file);
          }}
        >
          <div style={{ fontSize: 34 }}>⬓</div>
          <h3>拖入立体声母带文件</h3>
          <p>建议 44.1 / 48 kHz WAV；音频不会上传。也可以点击选择文件。</p>
          <button className="button primary" onClick={() => inputRef.current?.click()}>选择音频文件</button>
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept="audio/*,.wav,.flac,.aiff"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="panel">
        <SectionTitle title="自编风格母带与性能基准" note="这些片段由 TypeScript 振荡器、噪声鼓组和动态包络实时合成，不是外部音频资源。" />
        <div className="master-grid">
          {STYLE_LIST.map((style) => {
            const meta = STYLE_CARD_COPY[style];
            const selected = selectedId === `style-${style}` && !isProgram22;
            return (
              <button
                key={style}
                className={`master-card ${selected ? 'selected' : ''}`}
                onClick={() => onSelectStyle(style)}
                disabled={loading}
              >
                <span className="style-pill">{STYLE_LABEL[style]}</span>
                <h3>{meta.title}</h3>
                <p>{meta.description}</p>
                <div className="master-meta">
                  <span>{meta.bpm} BPM</span>
                  <span>约 42 秒</span>
                </div>
              </button>
            );
          })}
          <button
            className={`master-card program ${isProgram22 ? 'selected' : ''}`}
            onClick={onSelectProgram}
            disabled={loading}
          >
            <span className="style-pill">22:00 整面</span>
            <h3>22 分钟多风格专辑面</h3>
            <p>按圈生成物理包络，不分配数百 MB 音频缓冲；用于验证一分钟内完成整面变距规划。</p>
            <div className="master-meta">
              <span>8 个段落</span>
              <span>{formatTime(PROGRAM_22MIN_SEC)}</span>
            </div>
          </button>
        </div>
      </section>

      {loading ? (
        <section className="panel loading-screen">
          <div>
            <div className="spinner" />
            正在合成 / 解码母带并计算沟槽……
          </div>
        </section>
      ) : isProgram22 ? (
        <section className="panel">
          <SectionTitle title="当前基准：22 分钟多风格专辑面" note="规划器使用与音频母带相同的每圈最大摆幅、槽宽和深度字段。试听页会使用对应风格的可听片段。" />
          <div className="grid cols-4">
            <StatCard label="总时长" value="22:00" tone="teal" />
            <StatCard label="转速" value="33⅓" unit="rpm" />
            <StatCard label="圈数" value={String(Math.ceil(PROGRAM_22MIN_SEC / 1.8))} unit="圈" />
            <StatCard label="段落" value={String(PROGRAM_22MIN_SECTIONS.length)} unit="段" />
          </div>
          <div className="table-wrap section-space">
            <table>
              <thead><tr><th>时间</th><th>段落</th><th>风格</th><th>能量</th></tr></thead>
              <tbody>
                {PROGRAM_22MIN_SECTIONS.map((s) => (
                  <tr key={s.startSec}>
                    <td>{formatTime(s.startSec)}–{formatTime(s.endSec)}</td>
                    <td>{s.title}</td>
                    <td>{STYLE_LABEL[s.style] ?? '终曲'}</td>
                    <td>{Math.round(s.energy * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : track ? (
        <section className="panel">
          <SectionTitle
            title={`${track.title} — ${track.artist}`}
            note={track.description}
            right={<Badge tone="good">{track.generated ? '程序化自编母带' : '已导入文件'}</Badge>}
          />
          <WaveformCanvas track={track} />
          <div className="grid cols-4 section-space">
            <StatCard label="时长" value={formatTime(track.durationSec)} />
            <StatCard label="采样率" value={(track.sampleRate / 1000).toFixed(1)} unit="kHz" />
            <StatCard label="声道" value="2.0" unit="立体声" />
            <StatCard label="速度" value={String(track.bpm)} unit="BPM" />
          </div>
        </section>
      ) : null}
    </div>
  );
}

const STYLE_CARD_COPY: Record<string, { title: string; description: string; bpm: number }> = {
  rock: { title: '冲床之夜', description: '重型底鼓、失真吉他墙和压缩总线，低频沟槽摆动最宽。', bpm: 132 },
  jazz: { title: '深夜三点的爵士棚', description: '立式贝斯、Rhodes 与摇摆镲片，动态宽松且安静段多。', bpm: 104 },
  classical: { title: '小调钢琴与大提琴', description: '极弱琶音到强奏齐奏，检验浅槽、抬刀和圈距收缩。', bpm: 76 },
  electronic: { title: '内圈霓虹', description: '深贝斯、侧链泵感和高频十六分音符，暴露内圈跟踪失真。', bpm: 124 },
  hiphop: { title: '采样间的节拍', description: 'Boom-bap 鼓组、低频 sine bass 与爵士和弦切片。', bpm: 88 },
};
