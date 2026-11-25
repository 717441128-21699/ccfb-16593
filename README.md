# 刻纹台 · Vinyl Master Groove Planner

一个纯本地运行的黑胶刻母盘几何预演与试听应用。它在刻片前把立体声母带转换为 45/45 横向/纵向沟槽运动，施加 RIAA 预加重，按每圈摆幅规划变距，校验相邻圈槽壁不相交，并通过 Web Audio API + AudioWorklet 模拟唱针针尖半径导致的内圈跟踪失真。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

约束测试 / 验收脚本：

```bash
npm run verify
```

测试覆盖：

- RIAA 预加重与回放去加重在 20 Hz–20 kHz、44.1/48/96 kHz 下叠加误差 `< 0.5 dB`；
- 22:00 编程母带生成 734 圈，规划耗时远低于 60 秒（通常数毫秒）；
- 变距规划后相邻圈相交数为 0，最小间隙满足安全余量；
- 同一 22 分钟多风格母带的变距满盘容量显著高于“按整面最响峰值取的安全固定圈距”；
- 五种程序化自编风格母带均通过采样级相邻沟槽校验；
- 针尖跟踪 THD 随半径减小而单调上升。

## 四个页面

1. **母带导入**：本地解码音频文件，或选择 Rock / Jazz / Classical / Electronic / Hip-hop 五段 TypeScript 合成母带；另有 22 分钟多风格整面性能基准。
2. **沟槽几何**：L/R → 横向 `L+R`、纵向 `L−R`，RIAA、速度到位移的漏积分、槽深/槽宽、整面俯视图和相邻槽壁放大图。
3. **圈距规划**：逐圈进给、半径、摆幅、槽深、THD、风险标记、固定圈距对照、容量提升和完整逐圈表。
4. **模拟试听**：母带原声 / 仅预加重 / 唱针回放三模式；Web Audio IIR RIAA 链，`public/worklets/tracking-processor.js` 完成积分、针尖几何失真和微分回放，半径随播放头映射。

## 核心几何模型

单位为 mm / s：

```text
pre_L = RIAA_pre(L)
pre_R = RIAA_pre(R)
x_L   = leaky_integrate(velocityGain · pre_L / f_s)
x_R   = leaky_integrate(velocityGain · pre_R / f_s)

lateral  x = (x_L + x_R) / √2
vertical z = verticalTrim · (x_L − x_R) / √2
depth    d = baseDepth − z
halfWidth w = kerf + max(d, 0) · tan(grooveAngle / 2)
reach_i  = max|x_i| + max(w_i)
need_i   = reach_i + reach_{i+1} + safety
```

螺旋在同一角度上的相邻圈间距是 `feed[i]` 与 `feed[i+1]` 的线性混合。规划器把每个相邻圈需求同时压到两侧进给上：

```text
feed[i]   >= need[i]
feed[i+1] >= need[i]
```

因此任意角度的名义间距都不小于 `need[i]`，再扣除两圈的实际横向偏移和槽宽后，仍保留至少 `safety` 的壁间间隙。

## 22 分钟母带为什么不直接分配音频缓冲

22 分钟、44.1 kHz 双声道 Float32 全量缓冲约 466 MB，而圈距规划只需要每圈的保守峰值、槽深、槽宽和斜率。`src/audio/longProgram.ts` 直接生成 734 个与音频分析结果同构的 `Excursion`，所以整面规划通常在几毫秒内完成。试听页会为该整面基准生成同风格短片段，并把播放时间映射到 22 分钟规划的半径曲线。

## 主要目录

```text
public/worklets/tracking-processor.js  AudioWorklet 针尖跟踪模型
src/audio/generateMusic.ts             五种风格程序化母带
src/audio/longProgram.ts               22 分钟整面圈级母带
src/audio/riaa.ts                      RIAA 时间常数与双线性 IIR
src/audio/tracking.ts                  针尖半径/线速度/THD 模型
src/audio/PlaybackEngine.ts            Web Audio 图与传输控制
src/geometry/groove.ts                 立体声到沟槽位移
src/geometry/planner.ts                变距规划与碰撞校验
src/components/                        四个页面和 Canvas 图表
src/constraints.test.ts                数值验收测试
```

所有音频均在浏览器或本地测试进程中生成/处理，不会上传。
