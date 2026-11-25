import { useEffect, useDeferredValue, useMemo, useState } from 'react';
import { GeometryPage } from './components/GeometryPage';
import { ImportPage } from './components/ImportPage';
import { ListenPage } from './components/ListenPage';
import { PitchPage } from './components/PitchPage';
import { generateStyleTrack } from './audio/generateMusic';
import {
  PROGRAM_22MIN_SEC,
  createProgram22Excursions,
} from './audio/longProgram';
import { computeGrooveBuffer } from './geometry/groove';
import { planAudioMaster, planFromExcursions } from './geometry/planner';
import {
  DEFAULT_GEOMETRY_CONFIG,
  type GeometryConfig,
  type MasterTrack,
  type MusicStyle,
  type PageId,
  type PlanResult,
} from './types';

const NAV: Array<{ id: PageId; index: string; label: string; title: string; subtitle: string }> = [
  {
    id: 'import',
    index: '01',
    label: '母带导入',
    title: '母带导入',
    subtitle: '导入立体声文件，或试听并选择五段自编风格母带与 22 分钟整面基准。',
  },
  {
    id: 'geometry',
    index: '02',
    label: '沟槽几何',
    title: '沟槽几何',
    subtitle: '把 L/R 转换为 45/45 横向与纵向运动，施加 RIAA 预加重，计算槽深、槽宽和相邻圈包络。',
  },
  {
    id: 'pitch',
    index: '03',
    label: '圈距规划',
    title: '变距圈距规划',
    subtitle: '安静段收紧、强低频段拉开；规划器证明相邻沟槽包络不相交，并比较安全固定圈距的整面容量。',
  },
  {
    id: 'listen',
    index: '04',
    label: '模拟试听',
    title: '唱针回放试听',
    subtitle: 'Web Audio API 搭建回放链，AudioWorklet 模拟针尖半径造成的内圈跟踪失真。',
  },
];

async function decodeFile(file: File): Promise<MasterTrack> {
  const buffer = await file.arrayBuffer();
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const audio = await ctx.decodeAudioData(buffer.slice(0));
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
    return {
      id: `import-${file.name}-${file.size}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '本地导入母带',
      style: 'electronic',
      generated: false,
      description: '由浏览器 Web Audio 解码的本地音频文件。',
      bpm: 0,
      sampleRate: audio.sampleRate,
      durationSec: audio.duration,
      left: left.slice(),
      right: right.slice(),
    };
  } finally {
    void ctx.close();
  }
}

export default function App() {
  const [page, setPage] = useState<PageId>(() => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return (['import', 'geometry', 'pitch', 'listen'] as const).includes(hash as PageId)
      ? (hash as PageId)
      : 'import';
  });
  const [config, setConfig] = useState<GeometryConfig>(DEFAULT_GEOMETRY_CONFIG);
  const deferredConfig = useDeferredValue(config);
  const [selectedId, setSelectedId] = useState('program22');
  const [track, setTrack] = useState<MasterTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewStyle, setPreviewStyle] = useState<MusicStyle>('electronic');

  const isProgram22 = selectedId === 'program22';

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (['import', 'geometry', 'pitch', 'listen'].includes(hash)) setPage(hash as PageId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const expected = `#/${page}`;
    if (window.location.hash !== expected) window.history.replaceState(null, '', expected);
  }, [page]);

  useEffect(() => {
    if (!selectedId.startsWith('style-')) return;
    const style = selectedId.replace('style-', '') as MusicStyle;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = window.setTimeout(() => {
      try {
        const next = generateStyleTrack(style, { durationSec: 42 });
        if (!cancelled) {
          setTrack(next);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [selectedId]);

  const mainGroove = useMemo(
    () => (track && !isProgram22 ? computeGrooveBuffer(track, deferredConfig) : null),
    [track, isProgram22, deferredConfig],
  );

  const plan: PlanResult | null = useMemo(() => {
    const start = performance.now();
    if (isProgram22) {
      const excursions = createProgram22Excursions(deferredConfig);
      return planFromExcursions(
        excursions,
        PROGRAM_22MIN_SEC,
        deferredConfig,
        'program-envelope',
        start,
      );
    }
    if (track && mainGroove) {
      return planAudioMaster(mainGroove, track.durationSec, deferredConfig);
    }
    return null;
  }, [isProgram22, track, mainGroove, deferredConfig]);

  const auditionTrack = useMemo<MasterTrack | null>(() => {
    if (!isProgram22 && track) return track;
    if (isProgram22) return generateStyleTrack(previewStyle, { durationSec: 28 });
    return track;
  }, [isProgram22, track, previewStyle]);

  const auditionGroove = useMemo(
    () => (auditionTrack ? computeGrooveBuffer(auditionTrack, deferredConfig) : null),
    [auditionTrack, deferredConfig],
  );

  const auditionPlan = useMemo(
    () =>
      auditionTrack && auditionGroove
        ? planAudioMaster(auditionGroove, auditionTrack.durationSec, deferredConfig)
        : null,
    [auditionTrack, auditionGroove, deferredConfig],
  );

  async function handleImportFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const imported = await decodeFile(file);
      setSelectedId(imported.id);
      setTrack(imported);
      setPage('geometry');
    } catch (e) {
      setError(`无法解码该文件：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const nav = NAV.find((n) => n.id === page) ?? NAV[0];
  const showWorking = loading || (!isProgram22 && !track) || !plan;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="vinyl-mark" aria-hidden />
          <div>
            <h1>刻纹台</h1>
            <p>LACQUER GEOMETRY</p>
          </div>
        </div>
        <nav className="nav" aria-label="主导航">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-button ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-index">{item.index}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-card">
          <h3><span className="status-dot" />约束自检</h3>
          <p>
            {plan
              ? `${plan.collision.collisions === 0 ? '相邻圈零相交' : '存在相交'} · 容量 +${plan.capacityGainPct.toFixed(0)}% · 规划 ${plan.planningMs.toFixed(0)} ms`
              : '正在初始化几何内核……'}
          </p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{nav.index} / VINYL CUTTING PREVISUALIZER</div>
            <h2 className="page-title">{nav.title}</h2>
            <p className="page-subtitle">{nav.subtitle}</p>
          </div>
          <div className="top-actions">
            <button className="button" onClick={() => setPage('import')}>母带</button>
            <button className="button primary" onClick={() => setPage('pitch')}>查看规划</button>
            <button className="button teal" onClick={() => setPage('listen')}>试听模拟</button>
          </div>
        </header>

        {error ? <div className="toast" role="alert">{error}</div> : null}

        {showWorking ? (
          <section className="panel loading-screen">
            <div>
              <div className="spinner" />
              {error ? '处理失败，请尝试另一个音频文件。' : '正在合成母带、计算 RIAA 与每圈沟槽包络……'}
            </div>
          </section>
        ) : page === 'import' ? (
          <ImportPage
            selectedId={selectedId}
            track={track}
            isProgram22={isProgram22}
            loading={loading}
            onSelectStyle={(style) => setSelectedId(`style-${style}`)}
            onSelectProgram={() => { setSelectedId('program22'); setLoading(false); }}
            onImportFile={(file) => void handleImportFile(file)}
          />
        ) : page === 'geometry' ? (
          <GeometryPage track={track} groove={mainGroove} plan={plan} config={config} />
        ) : page === 'pitch' ? (
          <PitchPage plan={plan} config={config} onConfigChange={setConfig} />
        ) : auditionTrack && auditionGroove && auditionPlan ? (
          <ListenPage
            track={auditionTrack}
            groove={auditionGroove}
            plan={auditionPlan}
            config={config}
            onConfigChange={setConfig}
            programPreview={isProgram22}
            previewStyle={previewStyle}
            onPreviewStyle={setPreviewStyle}
          />
        ) : (
          <section className="panel loading-screen"><div><div className="spinner" />正在准备试听片段……</div></section>
        )}
      </main>
    </div>
  );
}
