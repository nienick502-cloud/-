import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo_library.json'), 'utf8'));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>身临其境</title>
<style>
  :root {
    --bg: #f5f5f7;
    --ink: #1d1d1f;
    --ink-2: #6e6e73;
    --ink-3: #a1a1a6;
    --line: rgba(0, 0, 0, 0.08);
    --line-strong: rgba(0, 0, 0, 0.16);
    --glass: rgba(255, 255, 255, 0.55);
    --accent: #1d1d1f;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body { height: 100%; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* ---------- 流体背景 ---------- */
  #fluid {
    position: fixed;
    inset: -5%;
    width: 110%;
    height: 110%;
    z-index: 0;
    filter: blur(24px) saturate(1.15);
    pointer-events: none;
  }
  .veil {
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.35), rgba(255,255,255,0.1) 70%);
  }
  .grain {
    position: fixed;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    opacity: 0.05;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  /* ---------- 页面骨架 ---------- */
  .page {
    position: relative;
    z-index: 3;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 48px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 72px;
    border-bottom: 1px solid var(--line);
  }
  .wordmark {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .wordmark b {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.32em;
  }
  .wordmark span {
    font-size: 12px;
    color: var(--ink-2);
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .ghost-btn {
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    padding: 7px 18px;
    cursor: pointer;
    transition: background 0.3s var(--ease), border-color 0.3s var(--ease);
  }
  .ghost-btn:hover { background: rgba(255,255,255,0.6); border-color: var(--ink); }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 96px;
    padding: 48px 0;
  }

  /* ---------- 拍立得 ---------- */
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
  }
  .polaroid-wrap { perspective: 1200px; }
  .polaroid {
    width: 380px;
    background: #fbfbf8;
    padding: 18px 18px 0;
    border-radius: 3px;
    box-shadow:
      0 1px 1px rgba(0,0,0,0.04),
      0 6px 12px rgba(0,0,0,0.05),
      0 24px 48px rgba(0,0,0,0.10),
      0 48px 96px rgba(0,0,0,0.08);
    transform: rotate(-2.2deg);
    transition: transform 0.8s var(--ease), box-shadow 0.8s var(--ease);
    cursor: pointer;
  }
  .polaroid:hover { transform: rotate(0deg) translateY(-6px); }
  .polaroid.drag { transform: rotate(0deg) scale(1.03); }

  .photo {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    background: #ececea;
    overflow: hidden;
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .photo img.developing { animation: develop 2.4s var(--ease) forwards; }
  @keyframes develop {
    0%   { filter: brightness(1.9) saturate(0) contrast(0.6) blur(6px); opacity: 0.2; }
    40%  { filter: brightness(1.3) saturate(0.3) contrast(0.8) blur(2px); opacity: 0.8; }
    100% { filter: none; opacity: 1; }
  }
  .photo .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ink-3);
    font-size: 13px;
    letter-spacing: 0.1em;
  }
  .photo .empty i {
    width: 36px; height: 36px;
    border: 1px solid var(--ink-3);
    border-radius: 50%;
    position: relative;
  }
  .photo .empty i::before, .photo .empty i::after {
    content: ""; position: absolute; background: var(--ink-3);
    left: 50%; top: 50%; transform: translate(-50%, -50%);
  }
  .photo .empty i::before { width: 12px; height: 1px; }
  .photo .empty i::after { width: 1px; height: 12px; }

  .caption {
    height: 84px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 0 4px;
  }
  .caption .line {
    font-family: "Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif;
    font-size: 18px;
    color: #2c2c2e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caption .meta {
    font-size: 11px;
    color: var(--ink-3);
    letter-spacing: 0.16em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 示例照片 */
  .samples {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .samples small {
    font-size: 12px;
    color: var(--ink-2);
    letter-spacing: 0.08em;
    margin-right: 6px;
  }
  .sample {
    width: 44px;
    height: 52px;
    background: #fbfbf8;
    padding: 4px 4px 10px;
    border-radius: 2px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    cursor: pointer;
    transition: transform 0.4s var(--ease);
  }
  .sample:hover { transform: translateY(-3px) rotate(-3deg); }
  .sample.active { outline: 1px solid var(--ink); outline-offset: 3px; }
  .sample img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* ---------- 音乐面板 ---------- */
  .panel {
    min-width: 0;
    background: var(--glass);
    backdrop-filter: blur(40px) saturate(1.6);
    -webkit-backdrop-filter: blur(40px) saturate(1.6);
    border: 1px solid rgba(255,255,255,0.7);
    border-radius: 28px;
    padding: 40px 44px 34px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.06);
    transition: opacity 0.6s var(--ease), transform 0.6s var(--ease);
  }
  .panel.idle { opacity: 0.45; }

  .eyebrow {
    font-size: 12px;
    color: var(--ink-2);
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  .title {
    overflow-wrap: anywhere;
    margin-top: 12px;
    font-size: 36px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.18;
  }
  .artist {
    margin-top: 8px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .moods {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }
  .mood {
    font-size: 12px;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink);
    letter-spacing: 0.06em;
  }

  /* 段落时间线 */
  .timeline { margin-top: 34px; }
  .tl-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    color: var(--ink-2);
    margin-bottom: 14px;
  }
  .tl-head strong { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
  .track {
    position: relative;
    display: flex;
    gap: 4px;
  }
  .seg {
    position: relative;
    cursor: pointer;
    padding-top: 10px;
  }
  .seg .bar {
    height: 2px;
    background: var(--line-strong);
    border-radius: 2px;
    transition: background 0.4s var(--ease), height 0.4s var(--ease);
    position: relative;
    overflow: hidden;
  }
  .seg .fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 0;
    background: var(--ink);
  }
  .seg:hover .bar { background: rgba(0,0,0,0.3); }
  .seg.best .bar { height: 4px; margin-top: -1px; background: rgba(0,0,0,0.22); }
  .seg .lbl {
    margin-top: 10px;
    font-size: 11px;
    color: var(--ink-3);
    letter-spacing: 0.06em;
    white-space: nowrap;
    transition: color 0.3s;
  }
  .seg.best .lbl { color: var(--ink); font-weight: 500; }
  .seg.best::before {
    content: "";
    position: absolute;
    top: 0; left: 0;
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--ink);
  }

  /* 控制 */
  .controls {
    margin-top: 34px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .play {
    width: 56px; height: 56px;
    border-radius: 50%;
    border: none;
    background: var(--ink);
    color: #fff;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.3s var(--ease);
  }
  .play:hover { transform: scale(1.06); }
  .play svg { width: 18px; height: 18px; fill: #fff; }
  .text-btn {
    font: inherit;
    font-size: 13px;
    color: var(--ink-2);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.3s;
  }
  .text-btn:hover { color: var(--ink); }
  .eq {
    margin-left: auto;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 18px;
  }
  .eq i {
    width: 2px;
    height: 4px;
    background: var(--ink);
    border-radius: 1px;
    transition: height 0.15s;
  }

  /* 候选歌单微栏 */
  .candidates {
    margin-top: 26px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    color: var(--ink-2);
    padding: 5px 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.25s, color 0.25s;
  }
  .cand-row:hover {
    background: rgba(0,0,0,0.04);
    color: var(--ink);
  }
  .cand-row.active {
    color: var(--ink);
    font-weight: 500;
    background: rgba(0,0,0,0.05);
  }
  .cand-row span:last-child {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    color: var(--ink-3);
    font-size: 11px;
  }
  .cand-row span:first-child { min-width: 0; overflow-wrap: anywhere; }

  /* 匹配依据 */
  .why {
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .why div + div { border-left: 1px solid var(--line); padding-left: 20px; }
  .why span {
    display: block;
    font-size: 11px;
    color: var(--ink-3);
    letter-spacing: 0.14em;
  }
  .why b {
    display: block;
    margin-top: 6px;
    font-size: 15px;
    font-weight: 500;
  }

  footer {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--ink-3);
    letter-spacing: 0.1em;
  }

  .fade-swap { animation: fadeUp 0.7s var(--ease); }
  .match-state { min-height: 18px; margin: 12px 0 4px; color: var(--ink-2); font-size: 12px; line-height: 1.6; }
  .image-concepts { min-height: 18px; color: var(--ink-2); font-size: 12px; line-height: 1.6; }
  .audio-notice { color: var(--ink-2); font-size: 12px; line-height: 1.6; margin-top: 8px; }
  button:disabled { opacity: 0.4; cursor: wait; }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  @media (max-width: 960px) {
    .page { padding: 0 24px; }
    main { grid-template-columns: 1fr; gap: 48px; }
    .polaroid { width: 300px; }
    .title { font-size: 28px; }
  }
  @media (max-width: 600px) {
    main { grid-template-columns: minmax(0, 1fr); padding: 36px 0; }
    .polaroid { width: min(300px, calc(100vw - 64px)); }
    .samples { gap: 10px; }
    .panel { padding: 28px 20px; }
    .controls { gap: 14px; }
    .play { flex-shrink: 0; width: 48px; height: 48px; }
    .text-btn { white-space: nowrap; }
    .cand-row { align-items: flex-start; flex-direction: column; gap: 4px; }
    .why div + div { padding-left: 10px; }
    .why b { font-size: 13px; }
    footer { height: auto; min-height: 64px; padding: 14px 0; flex-direction: column; align-items: flex-start; gap: 8px; }
  }
  @media (max-width: 480px) { .wordmark span { display: none; } }
</style>
</head>
<body>
  <canvas id="fluid" width="160" height="100"></canvas>
  <div class="veil"></div>
  <div class="grain"></div>
  <audio id="realAudio" preload="auto"></audio>

  <div class="page">
    <header>
      <div class="wordmark">
        <b>身临其境</b>
        <span>Immersion</span>
      </div>
      <button class="ghost-btn" id="uploadBtn">放入照片</button>
    </header>

    <main>
      <section class="stage">
        <div class="polaroid-wrap">
          <div class="polaroid" id="polaroid">
            <div class="photo" id="photo">
              <div class="empty" id="empty"><i></i>轻触或拖入一张照片</div>
            </div>
            <div class="caption">
              <div class="line" id="captionLine">每张照片，都有它自己的声音</div>
              <div class="meta" id="captionMeta">— —</div>
            </div>
          </div>
        </div>

        <div class="samples" id="samples">
          <small>演示图</small>
        </div>
        <input type="file" id="file" accept="image/*" hidden />
      </section>

      <section class="panel idle" id="panel">
        <div class="eyebrow">此刻的声音</div>
        <div id="songBlock">
          <h1 class="title" id="title">等待一张照片</h1>
          <p class="artist" id="artist">放入照片后，从 33 首曲目中找到最契合的那一段旋律</p>
          <div class="moods" id="moods"></div>
        </div>
        <p class="match-state" id="matchStatus" role="status" aria-live="polite">放入照片，寻找此刻的声音</p>
        <p class="match-state" id="localEntry" hidden><a href="http://127.0.0.1:8765/" style="color:inherit;text-underline-offset:3px">打开本地语义版</a></p>
        <p class="image-concepts" id="imageConcepts"></p>

        <div class="timeline">
          <div class="tl-head">
            <span id="segName">段落</span>
            <strong id="time">0:00</strong>
          </div>
          <div class="track" id="track"></div>
        </div>

        <div class="controls">
          <button class="play" id="play" aria-label="播放">
            <svg viewBox="0 0 24 24" id="playIcon"><path d="M7 4.5v15l13-7.5z"/></svg>
          </button>
          <button class="text-btn" id="nextBtn">换一首</button>
          <button class="text-btn" id="loopModeBtn">段落循环</button>
          <div class="eq" id="eq"></div>
        </div>

        <p class="audio-notice" id="audioNotice" role="status"></p>

        <div class="candidates" id="candidates" style="display:none"></div>

        <div class="why">
          <div><span>色温</span><b id="whyWarm">—</b></div>
          <div><span>明度</span><b id="whyLum">—</b></div>
          <div><span>段落能量</span><b id="whyEnergy">—</b></div>
        </div>
      </section>
    </main>

    <footer>
      <span>BUILD IN BILIBILI · S2</span>
      <span>demo list · 已接入 ${lib.length} 首真实曲目与段落切分索引</span>
    </footer>
  </div>

<script>
/* =========================================================
   demo list 真实曲库（由 pipeline/analyze_demo_list.mjs 从 33 首 MP3 提取）
   每首歌含真实音频路径与 5 个结构段落 [段落名, 起始秒, 结束秒, 段落能量]
   ========================================================= */
const LIBRARY = ${JSON.stringify(lib)};

/* =========================================================
   演示占位：示例照片为程序生成的抽象色块，避免外部图片依赖
   ========================================================= */
const SAMPLE_SCENES = [
  { stops: ['#2b3a67', '#c86b5a', '#f4b67a', '#f7dcb4'], sun: '#fff1d0', horizon: 0.62, ground: '#3a3f5c' },
  { stops: ['#0d0f1e', '#1d1b3a', '#3a2350', '#5b2a62'], sun: '#ff5fa2', horizon: 0.7, ground: '#14162a' },
  { stops: ['#dfe7ef', '#eef2f6', '#f6f7f9', '#ffffff'], sun: '#ffffff', horizon: 0.66, ground: '#c9d3dc' },
  { stops: ['#3b2416', '#7a4a2a', '#c58a4f', '#e8c48f'], sun: '#ffe2a8', horizon: 0.72, ground: '#2a1a10' }
];

function makeSample(s) {
  const c = document.createElement('canvas');
  c.width = c.height = 600;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 600);
  s.stops.forEach((col, i) => g.addColorStop(i / (s.stops.length - 1) * s.horizon, col));
  g.addColorStop(1, s.ground);
  x.fillStyle = g;
  x.fillRect(0, 0, 600, 600);
  const r = x.createRadialGradient(400, 600 * s.horizon - 40, 0, 400, 600 * s.horizon - 40, 160);
  r.addColorStop(0, s.sun);
  r.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = r;
  x.fillRect(0, 0, 600, 600);
  x.fillStyle = s.ground;
  x.globalAlpha = 0.85;
  x.fillRect(0, 600 * s.horizon, 600, 600);
  x.globalAlpha = 1;
  return c.toDataURL('image/jpeg', 0.9);
}

/* =========================================================
   图像分析：主色提取 + 色温 / 明度 / 饱和度
   ========================================================= */
function analyzeImage(img) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;

  const buckets = new Map();
  let lum = 0, sat = 0, warm = 0, contrast = 0, n = 0;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const s = max ? (max - min) / max : 0;
    lum += l; sat += s; warm += (r - b) / 255;
    contrast += Math.abs(l - 0.5);
    n++;

    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bk = buckets.get(key) || { r: 0, g: 0, b: 0, c: 0, w: 0 };
    bk.r += r; bk.g += g; bk.b += b; bk.c++; bk.w += 0.5 + s;
    buckets.set(key, bk);
  }

  const sorted = [...buckets.values()].sort((a, b) => b.w - a.w)
    .map(bk => [bk.r / bk.c, bk.g / bk.c, bk.b / bk.c]);

  const palette = [];
  for (const col of sorted) {
    if (palette.every(p => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 56)) palette.push(col);
    if (palette.length === 4) break;
  }
  while (palette.length < 4) palette.push(palette[palette.length - 1] || [220, 220, 225]);

  return {
    palette,
    lum: lum / n,
    sat: sat / n,
    contrast: contrast / n,
    warm: Math.min(1, Math.max(0, (warm / n + 0.25) / 0.5))
  };
}

/* 照片特征 → 33首真实曲库段落级检索排序 */
function matchLibrary(features) {
  // 目标段落能量：饱和度高或明暗反差大 → 倾向高潮/副歌；柔和低饱和 → 倾向主歌/桥段/前奏
  const targetEnergy = Math.min(0.95, Math.max(0.22, features.sat * 0.78 + features.contrast * 0.65 + 0.18));

  const ranked = LIBRARY.map((song, i) => {
    // 找该歌曲中最契合照片目标能量的段落（优先非尾奏段）
    let bestSeg = 0;
    let bestSegDist = 99;
    song.segments.forEach((s, k) => {
      const penalty = k === 4 ? 0.18 : k === 0 && targetEnergy > 0.55 ? 0.12 : 0;
      const d = Math.abs(s[3] - targetEnergy) + penalty;
      if (d < bestSegDist) {
        bestSegDist = d;
        bestSeg = k;
      }
    });

    const colorDist = Math.abs(song.warm - features.warm) * 1.15 + Math.abs(song.lum - features.lum) * 0.95;
    const totalDist = colorDist + bestSegDist * 0.35;

    return {
      songIndex: i,
      segIndex: bestSeg,
      score: totalDist,
      energy: targetEnergy
    };
  }).sort((a, b) => a.score - b.score);

  return ranked;
}

/* =========================================================
   流体背景
   ========================================================= */
const fluid = document.getElementById('fluid');
const fctx = fluid.getContext('2d');
const W = fluid.width, H = fluid.height;

const DEFAULT_PALETTE = [[214, 222, 240], [240, 222, 230], [222, 236, 232], [236, 232, 220]];
const blobs = DEFAULT_PALETTE.map((col, i) => ({
  col: [...col], target: [...col],
  x: [0.25, 0.75, 0.35, 0.7][i], y: [0.3, 0.35, 0.75, 0.7][i],
  r: [0.55, 0.5, 0.6, 0.45][i],
  sx: 0.00011 + i * 0.00004, sy: 0.00009 + i * 0.00003, ph: i * 1.7
}));

function soften(rgb, k = 0.28) {
  return rgb.map(v => Math.round(v + (255 - v) * k));
}

function setFluidPalette(palette) {
  blobs.forEach((b, i) => { b.target = soften(palette[i % palette.length]); });
}

let energyPulse = 0;
function drawFluid(t) {
  const base = blobs.reduce((a, b) => a.map((v, k) => v + b.col[k] / blobs.length), [0, 0, 0]);
  fctx.fillStyle = \`rgb(\${base.map(v => Math.round(v)).join(',')})\`;
  fctx.fillRect(0, 0, W, H);

  const speed = 1 + energyPulse * 1.5;
  blobs.forEach(b => {
    for (let k = 0; k < 3; k++) b.col[k] += (b.target[k] - b.col[k]) * 0.025;
    const px = (b.x + Math.sin(t * b.sx * speed + b.ph) * 0.2) * W;
    const py = (b.y + Math.cos(t * b.sy * speed + b.ph * 1.3) * 0.2) * H;
    const rad = b.r * Math.max(W, H) * (1 + energyPulse * 0.08);
    const g = fctx.createRadialGradient(px, py, 0, px, py, rad);
    const c = b.col.map(Math.round).join(',');
    g.addColorStop(0, \`rgba(\${c},0.95)\`);
    g.addColorStop(1, \`rgba(\${c},0)\`);
    fctx.fillStyle = g;
    fctx.fillRect(0, 0, W, H);
  });
  requestAnimationFrame(drawFluid);
}
requestAnimationFrame(drawFluid);

/* =========================================================
   真实 MP3 音频播放引擎（支持按秒跳转 + 2 秒平滑渐入 + 段落循环）
   ========================================================= */
const audio = document.getElementById('realAudio');
let isPlaying = false;
let fadeTimer = null;
let loadedFile = '';
let loopSegmentOnly = true;
let playAttempt = 0;

function fadeInAudio(targetVol = 0.92, durationMs = 2000) {
  clearInterval(fadeTimer);
  audio.volume = 0.02;
  const steps = 40;
  const stepMs = durationMs / steps;
  const delta = (targetVol - 0.02) / steps;
  let count = 0;
  fadeTimer = setInterval(() => {
    count++;
    audio.volume = Math.min(targetVol, audio.volume + delta);
    if (count >= steps) clearInterval(fadeTimer);
  }, stepMs);
}

function startAudio(seekToSegStart = false) {
  if (state.songIndex < 0) return;
  const attempt = ++playAttempt;
  $('audioNotice').textContent = '';
  const song = LIBRARY[state.songIndex];
  const seg = song.segments[state.segIndex];
  const encodedSrc = song.file.split('/').map(encodeURIComponent).join('/');

  const playFromTarget = () => {
    if (attempt !== playAttempt) return;
    if (seekToSegStart || audio.currentTime < seg[1] || audio.currentTime >= seg[2]) {
      audio.currentTime = seg[1];
    }
    fadeInAudio(0.92, 2000);
    audio.play().then(() => {
      if (attempt !== playAttempt) return;
      isPlaying = true;
      setPlayIcon();
    }).catch(err => {
      if (attempt !== playAttempt) return;
      clearInterval(fadeTimer);
      console.warn('播放需用户交互触发:', err);
      isPlaying = false;
      setPlayIcon();
      $('audioNotice').textContent = err.name === 'NotAllowedError'
        ? '点击播放，听听这段旋律。' : '音频暂时无法播放，请检查本地曲目是否存在。';
    });
  };

  if (loadedFile !== song.file) {
    loadedFile = song.file;
    audio.onloadedmetadata = () => playFromTarget();
    audio.src = encodedSrc;
  } else if (audio.readyState < 1) {
    audio.onloadedmetadata = () => playFromTarget();
  } else {
    playFromTarget();
  }
}

function stopAudio() {
  playAttempt++;
  audio.onloadedmetadata = null;
  clearInterval(fadeTimer);
  isPlaying = false;
  audio.pause();
  setPlayIcon();
}

audio.addEventListener('error', () => {
  stopAudio();
  loadedFile = '';
  $('audioNotice').textContent = '音频暂时无法播放，请检查本地曲目是否存在。';
});
audio.addEventListener('ended', () => { isPlaying = false; setPlayIcon(); });

audio.addEventListener('timeupdate', () => {
  if (state.songIndex < 0) return;
  const song = LIBRARY[state.songIndex];
  const seg = song.segments[state.segIndex];

  if (loopSegmentOnly && audio.currentTime >= seg[2]) {
    audio.currentTime = seg[1];
    fadeInAudio(0.92, 1400);
  } else if (!loopSegmentOnly) {
    const curIdx = segmentAt(audio.currentTime);
    if (curIdx !== state.segIndex) {
      state.segIndex = curIdx;
      renderSegmentsBar();
    }
  }
  renderProgress();
});

/* =========================================================
   UI 状态与渲染
   ========================================================= */
const state = {
  songIndex: -1,
  segIndex: 0,
  energy: 0.5,
  features: null,
  rankedList: [],
  rankCursor: 0
};
const $ = id => document.getElementById(id);

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return \`\${Math.floor(s / 60)}:\${String(s % 60).padStart(2, '0')}\`;
}

function segmentAt(t) {
  const segs = LIBRARY[state.songIndex].segments;
  const i = segs.findIndex(s => t >= s[1] && t < s[2]);
  return i < 0 ? segs.length - 1 : i;
}

function setPlayIcon() {
  $('playIcon').innerHTML = isPlaying
    ? '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>'
    : '<path d="M7 4.5v15l13-7.5z"/>';
}

function renderSegmentsBar() {
  const song = LIBRARY[state.songIndex];
  $('track').innerHTML = song.segments.map((s, k) => \`
    <div class="seg \${k === state.segIndex ? 'best' : ''}" data-k="\${k}" style="flex:\${Math.max(8, s[2] - s[1])}">
      <div class="bar"><div class="fill"></div></div>
      <div class="lbl">\${s[0]}</div>
    </div>\`).join('');

  $('track').querySelectorAll('.seg').forEach(el => {
    el.onclick = () => {
      state.segIndex = +el.dataset.k;
      renderSegmentsBar();
      startAudio(true);
    };
  });
}

function renderCandidates() {
  const box = $('candidates');
  if (!state.rankedList.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  const top4 = state.rankedList.slice(0, 4);
  box.innerHTML = top4.map((item, idx) => {
    const s = LIBRARY[item.songIndex];
    const seg = s.segments[item.segIndex];
    const active = item.songIndex === state.songIndex ? 'active' : '';
    return \`
      <div class="cand-row \${active}" data-r="\${idx}">
        <span>\${idx === 0 ? '最佳契合 · ' : '候选 · '}\${s.title} — \${s.artist}</span>
        <span>\${seg[0]} \${fmt(seg[1])}–\${fmt(seg[2])}</span>
      </div>
    \`;
  }).join('');

  box.querySelectorAll('.cand-row').forEach(el => {
    el.onclick = () => {
      const rIdx = +el.dataset.r;
      const pick = state.rankedList[rIdx];
      state.rankCursor = rIdx;
      state.songIndex = pick.songIndex;
      state.segIndex = pick.segIndex;
      renderSong();
      startAudio(true);
    };
  });
}

function renderSong() {
  const song = LIBRARY[state.songIndex];
  const seg = song.segments[state.segIndex];
  state.energy = seg[3];

  $('panel').classList.remove('idle');
  const block = $('songBlock');
  block.classList.remove('fade-swap'); void block.offsetWidth; block.classList.add('fade-swap');

  $('title').textContent = song.title;
  $('artist').textContent = song.artist;
  $('moods').innerHTML = song.moods.map(m => \`<span class="mood">\${m}</span>\`).join('');
  $('captionLine').textContent = song.line;

  renderSegmentsBar();
  renderCandidates();

  const f = state.features;
  $('whyWarm').textContent = f.warm > 0.58 ? '偏暖' : f.warm < 0.42 ? '偏冷' : '中性';
  $('whyLum').textContent = \`\${Math.round(f.lum * 100)}%\`;
  $('whyEnergy').textContent = seg[3] > 0.72 ? '高 · 副歌爆发' : seg[3] > 0.45 ? '中 · 叙事律动' : '低 · 留白静谧';

  renderProgress(seg[1]);
}

function renderProgress(overrideTime) {
  if (state.songIndex < 0) return;
  const song = LIBRARY[state.songIndex];
  const seg = song.segments[state.segIndex];
  const cur = overrideTime !== undefined ? overrideTime : (loadedFile === song.file ? audio.currentTime : seg[1]);

  $('segName').textContent = \`\${seg[0]} · \${fmt(seg[1])} — \${fmt(seg[2])}\`;
  $('time').textContent = fmt(cur);
  $('track').querySelectorAll('.seg').forEach((el, k) => {
    const s = song.segments[k];
    const p = cur >= s[2] ? 100 : cur <= s[1] ? 0 : (cur - s[1]) / Math.max(1, s[2] - s[1]) * 100;
    el.querySelector('.fill').style.width = p + '%';
  });
}

/* 均衡器小动画 + 让背景随当前段落真实能量“呼吸” */
const eq = $('eq');
eq.innerHTML = '<i></i>'.repeat(5);
const eqBars = [...eq.children];
(function eqLoop(t) {
  if (isPlaying && state.songIndex >= 0) {
    const song = LIBRARY[state.songIndex];
    const seg = song.segments[state.segIndex];
    const e = seg ? seg[3] : 0.6;
    eqBars.forEach((b, i) => {
      const wave = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.0055 * (1 + i * 0.28) + i * 1.3));
      b.style.height = Math.max(3, Math.round(wave * e * 18)) + 'px';
    });
    energyPulse += (e - energyPulse) * 0.06;
  } else {
    eqBars.forEach(b => { b.style.height = '3px'; });
    energyPulse *= 0.95;
  }
  requestAnimationFrame(eqLoop);
})(0);

/* =========================================================
   放入照片
   ========================================================= */
let photoSequence = 0;
let matchController = null;
const semanticOrigin = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
$('localEntry').hidden = location.protocol !== 'file:';

function setMatchingBusy(busy) {
  ['play', 'nextBtn', 'loopModeBtn'].forEach(id => { $(id).disabled = busy; });
}

function validRanking(ranked) {
  return Array.isArray(ranked) && ranked.length === LIBRARY.length
    && ranked.every(p => p && Number.isInteger(p.songIndex) && Number.isInteger(p.segIndex)
      && LIBRARY[p.songIndex]?.segments[p.segIndex] && Number.isFinite(p.score)
      && Number.isFinite(p.energy) && p.file === LIBRARY[p.songIndex].file
      && p.start === LIBRARY[p.songIndex].segments[p.segIndex][1]
      && p.end === LIBRARY[p.songIndex].segments[p.segIndex][2])
    && new Set(ranked.map(p => p.songIndex)).size === LIBRARY.length;
}

function loadPhoto(src, label, autoPlay = true, originalFile = null) {
  const sequence = ++photoSequence;
  matchController?.abort();
  const controller = new AbortController();
  matchController = controller;
  stopAudio();
  state.songIndex = -1;
  state.rankedList = [];
  renderCandidates();
  $('panel').classList.add('idle');
  $('title').textContent = '正在感受这张照片';
  $('artist').textContent = '寻找与画面契合的一段旋律';
  $('moods').replaceChildren();
  $('track').replaceChildren();
  $('imageConcepts').textContent = '';
  $('audioNotice').textContent = '';
  $('matchStatus').textContent = '正在本地匹配…';
  setMatchingBusy(true);
  const img = new Image();
  img.onload = async () => {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    if (sequence !== photoSequence) return;
    $('empty')?.remove();
    const photo = $('photo');
    photo.querySelector('img')?.remove();
    img.className = 'developing';
    photo.appendChild(img);

    const features = analyzeImage(img);
    state.features = features;
    const d = new Date();
    $('captionMeta').textContent = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0')
      + '.' + String(d.getDate()).padStart(2, '0') + '  ·  ' + label;
    setFluidPalette(features.palette);

    let ranked;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
    try {
      const blob = originalFile || await (await fetch(src)).blob();
      const form = new FormData();
      form.append('file', blob, originalFile?.name || 'photo.jpg');
      const response = await fetch(semanticOrigin + '/api/match', {
        method: 'POST', body: form, signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error('本地语义服务未就绪');
        error.status = response.status;
        throw error;
      }
      const result = await response.json();
      if (result.method !== 'semantic' || !validRanking(result.ranked)) {
        const error = new Error('语义结果与页面曲库不一致');
        error.status = 502;
        error.code = 'library_mismatch';
        throw error;
      }
      if (sequence !== photoSequence) return;
      ranked = result.ranked;
      $('matchStatus').textContent = '本地语义匹配';
      const labels = (result.concepts || []).slice(0, 3).map(c => c.label).filter(x => typeof x === 'string');
      $('imageConcepts').textContent = labels.length ? '画面意境 · ' + labels.join(' · ') : '';
    } catch (error) {
      if (sequence !== photoSequence) return;
      ranked = matchLibrary(features);
      $('matchStatus').textContent = error.code === 'library_mismatch' ? '色彩匹配 · 语义结果与页面曲库不一致'
        : timedOut ? '色彩匹配 · 本地语义匹配超时'
        : error.status ? '色彩匹配 · 本地语义服务未就绪' : '色彩匹配 · 本地语义服务未连接';
      $('imageConcepts').textContent = '';
      console.info('本次采用色彩规则：', error.message);
    } finally {
      clearTimeout(timer);
    }
    if (sequence !== photoSequence) return;
    const pick = ranked[0];
    state.rankedList = ranked;
    state.rankCursor = 0;
    state.energy = pick.energy;
    state.songIndex = pick.songIndex;
    state.segIndex = pick.segIndex;
    setMatchingBusy(false);
    renderSong();
    if (autoPlay) startAudio(true);
  };
  img.onerror = () => {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    if (sequence !== photoSequence) return;
    $('title').textContent = '这张照片暂时无法读取';
    $('artist').textContent = '请试试 JPEG、PNG 或 WebP 图片';
    $('matchStatus').textContent = '请重新选择照片';
    setMatchingBusy(false);
  };
  img.src = src;
}

function readFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  document.querySelectorAll('.sample').forEach(s => s.classList.remove('active'));
  loadPhoto(URL.createObjectURL(file), file.name.replace(/\\.[^.]+$/, '').slice(0, 16), true, file);
}

$('polaroid').onclick = () => $('file').click();
$('uploadBtn').onclick = () => $('file').click();
$('file').onchange = e => readFile(e.target.files[0]);

['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); $('polaroid').classList.add('drag');
}));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault(); $('polaroid').classList.remove('drag');
}));
document.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));

$('play').onclick = () => {
  if (state.songIndex < 0) { $('file').click(); return; }
  isPlaying ? stopAudio() : startAudio(false);
};

$('nextBtn').onclick = () => {
  if (!state.rankedList.length) return;
  state.rankCursor = (state.rankCursor + 1) % Math.min(8, state.rankedList.length);
  const pick = state.rankedList[state.rankCursor];
  state.songIndex = pick.songIndex;
  state.segIndex = pick.segIndex;
  renderSong();
  startAudio(true);
};

$('loopModeBtn').onclick = () => {
  loopSegmentOnly = !loopSegmentOnly;
  $('loopModeBtn').textContent = loopSegmentOnly ? '段落循环' : '整首连播';
};

/* 演示占位：以下示例均为程序生成的图片 */
const sampleNames = ['黄昏', '夜色', '雪原', '午后'];
SAMPLE_SCENES.forEach((s, i) => {
  const src = makeSample(s);
  const el = document.createElement('div');
  el.className = 'sample';
  el.innerHTML = \`<img src="\${src}" alt="\${sampleNames[i]}">\`;
  el.onclick = () => {
    document.querySelectorAll('.sample').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    loadPhoto(src, sampleNames[i] + ' · 演示图', true);
  };
  $('samples').appendChild(el);
});
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');
console.log('✅ index.html 已更新并内联 33 首真实曲目与段落切分数据');
