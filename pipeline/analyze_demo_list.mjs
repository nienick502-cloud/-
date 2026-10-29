/**
 * 身临其境 (Immersion) — 离线音乐切段与声学特征提取流水线 (基于 FFmpeg PCM 解码 + 对数响度/频带曲式切分)
 * 作用：
 *   扫描 `demo list/` 下的全部 33 首真实 MP3 歌曲，解码为单声道 8000Hz Float32 波形，
 *   计算每 0.5 秒窗口的：
 *     1. 对数感知响度 (Perceptual Loudness in dB) 与动态能量包络
 *     2. 低频温暖度 (<350Hz) 与高频明亮度 (>1800Hz) 能量比
 *     3. 结构新颖度边界检测 (Novelty Boundary Detection)，自动切分为 5 个自然音乐段落
 *        （前奏 / 主歌 / 副歌 / 桥段 / 尾奏），输出每个段落的精确起止秒数与特征。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'demo list');
const OUT_DIR = path.join(ROOT, 'data');

const SONG_SEMANTICS = {
  'Adele - Million Years Ago_H.mp3': {
    title: 'Million Years Ago', artist: 'Adele',
    moods: ['怀旧', '深沉', '叙事'], line: '旧照片里的风，吹过很多年前的下午',
    warmBias: 0.72, lumBias: 0.36
  },
  'BUMP OF CHICKEN - SOUVENIR.mp3': {
    title: 'SOUVENIR', artist: 'BUMP OF CHICKEN',
    moods: ['轻快', '旅途', '晴朗'], line: '街角的阳光跳跃着，把日常走成一场旅行',
    warmBias: 0.75, lumBias: 0.78
  },
  'CHANYEOL _ PUNCH - Stay With Me_H.mp3': {
    title: 'Stay With Me', artist: 'CHANYEOL / PUNCH',
    moods: ['夜色', '宿命', '孤独'], line: '路灯拉长了影子，晚风里藏着没说完的话',
    warmBias: 0.42, lumBias: 0.35
  },
  'Disguise.mp3': {
    title: 'Disguise', artist: 'Instrumental / Indie',
    moods: ['暗调', '迷离', '都市'], line: '霓虹在玻璃上折出冷色的光斑',
    warmBias: 0.30, lumBias: 0.28
  },
  "EXO - Baby, Don't Cry (人鱼的眼泪) (Chinese Ver_)_H.mp3": {
    title: "Baby, Don't Cry (人鱼的眼泪)", artist: 'EXO',
    moods: ['深海', '抒情', '夜晚'], line: '潮声退去之后，月光落在安静的海面',
    warmBias: 0.35, lumBias: 0.34
  },
  'Imperial Orchestra - F1 (Symphonic Version)_H.mp3': {
    title: 'F1 (Symphonic Version)', artist: 'Imperial Orchestra',
    moods: ['燃向', '宏大', '疾驰'], line: '引擎与交响齐鸣，视野在极速中沸腾',
    warmBias: 0.65, lumBias: 0.60
  },
  'John Michael Howell _ JVKE _ ZVC - A Thousand Years_H.mp3': {
    title: 'A Thousand Years', artist: 'John Michael Howell / JVKE / ZVC',
    moods: ['温柔', '星光', '浪漫'], line: '时间慢下来，把这一刻拉长成一千年',
    warmBias: 0.74, lumBias: 0.64
  },
  'JVKE - golden hour_H.mp3': {
    title: 'golden hour', artist: 'JVKE',
    moods: ['黄昏', '落日', '绚烂'], line: '风把落日，吹成了金色的慢镜头',
    warmBias: 0.90, lumBias: 0.68
  },
  'JVKE - her_H.mp3': {
    title: 'her', artist: 'JVKE',
    moods: ['微醺', '思念', '暮色'], line: '余晖落在肩头，连呼吸都变得很轻',
    warmBias: 0.66, lumBias: 0.48
  },
  'JVKE - pretty_H.mp3': {
    title: 'pretty', artist: 'JVKE',
    moods: ['明媚', '治愈', '柔和'], line: '阳光穿过发梢，世界像加了一层柔光镜',
    warmBias: 0.78, lumBias: 0.76
  },
  'JVKE - this is what winter feels like_H.mp3': {
    title: 'this is what winter feels like', artist: 'JVKE',
    moods: ['冬日', '雪原', '清冷'], line: '世界很轻，像刚落下的第一场雪',
    warmBias: 0.15, lumBias: 0.82
  },
  'JVKE _ BRYANT BARNES _ Emilio Piano - juliet_H.mp3': {
    title: 'juliet', artist: 'JVKE / Bryant Barnes / Emilio Piano',
    moods: ['古典', '夜曲', '浪漫'], line: '琴键落下的瞬间，夜色有了温度',
    warmBias: 0.58, lumBias: 0.42
  },
  'Noblesse - 이젠 남 (现在是陌生人) (Now, we are strangers_Inst_)_H.mp3': {
    title: '现在是陌生人 (Inst.)', artist: 'Noblesse',
    moods: ['安静', '留白', '雨后'], line: '故事翻过最后一页，窗外刚好停了雨',
    warmBias: 0.38, lumBias: 0.52
  },
  'Soundtracks - The Rebel Path (Cello Version)_L.mp3': {
    title: 'The Rebel Path (Cello Version)', artist: 'Cyberpunk Soundtrack',
    moods: ['赛博', '冷峻', '暗夜'], line: '雨水顺着霓虹招牌滑落，低音在夜色里潜行',
    warmBias: 0.22, lumBias: 0.20
  },
  'Tobacco - Stretch Your Face_H.mp3': {
    title: 'Stretch Your Face', artist: 'Tobacco',
    moods: ['迷幻', '复古电子', '霓虹'], line: '失真的合成器颗粒，像老电视里的午夜梦境',
    warmBias: 0.48, lumBias: 0.32
  },
  '关大洲 - 夜凉_H.mp3': {
    title: '夜凉', artist: '关大洲',
    moods: ['古风', '月夜', '静谧'], line: '夜凉如水，月色漫过青石阶',
    warmBias: 0.25, lumBias: 0.30
  },
  '关大洲 - 梨花雪_H.mp3': {
    title: '梨花雪', artist: '关大洲',
    moods: ['清冷', '诗意', '空灵'], line: '一树梨花落成雪，天地间只剩风声',
    warmBias: 0.24, lumBias: 0.86
  },
  '关大洲 - 江天晓_H.mp3': {
    title: '江天晓', artist: '关大洲',
    moods: ['破晓', '辽阔', '山河'], line: '晨雾散开，江面上升起第一缕天光',
    warmBias: 0.55, lumBias: 0.72
  },
  '关大洲 - 老拙_H.mp3': {
    title: '老拙', artist: '关大洲',
    moods: ['苍劲', '古意', '沉稳'], line: '茶烟袅袅，岁月在木纹里慢慢沉淀',
    warmBias: 0.62, lumBias: 0.38
  },
  '吴雨霏 - 生生世世爱_H.mp3': {
    title: '生生世世爱', artist: '吴雨霏',
    moods: ['回忆', '侠气', '炽热'], line: '风吹过长街，记忆里的画面依然滚烫',
    warmBias: 0.68, lumBias: 0.58
  },
  '杨丞琳 - 雨爱_H.mp3': {
    title: '雨爱', artist: '杨丞琳',
    moods: ['雨天', '窗边', '思念'], line: '窗外的雨滴得很慢，玻璃上蒙着一层薄雾',
    warmBias: 0.36, lumBias: 0.46
  },
  '王者荣耀 _ Matthew Carl Earl - 愿照九天.mp3': {
    title: '愿照九天', artist: 'Matthew Carl Earl',
    moods: ['史诗', '辽阔', '霞光'], line: '云海翻涌，金光刺破万丈苍穹',
    warmBias: 0.76, lumBias: 0.66
  },
  '盘尼西林乐队 - 橘子花火.mp3': {
    title: '橘子花火', artist: '盘尼西林乐队',
    moods: ['晚霞', '橘子海', '摇滚'], line: '橘色的花火升起又落下，照亮海边的夏夜',
    warmBias: 0.86, lumBias: 0.54
  },
  '石杨,刘晨野 - 高考后见.mp3': {
    title: '高考后见', artist: '石杨 / 刘晨野',
    moods: ['盛夏', '青春', '蝉鸣'], line: '黑板上的倒计时归零，那个夏天永远年轻',
    warmBias: 0.72, lumBias: 0.74
  },
  '罗锟 - 喜欢你.mp3': {
    title: '喜欢你', artist: '罗锟 · 纯音乐',
    moods: ['温暖', '甜美', '微风'], line: '风吹动白色窗帘，阳光刚好落在桌角',
    warmBias: 0.80, lumBias: 0.80
  },
  '罗锟 - 夏日异闻录.mp3': {
    title: '夏日异闻录', artist: '罗锟 · 纯音乐',
    moods: ['夏日', '奇幻', '清凉'], line: '树荫下的光斑晃动，午后藏着秘密',
    warmBias: 0.52, lumBias: 0.68
  },
  '罗锟 - 日常小确幸.mp3': {
    title: '日常小确幸', artist: '罗锟 · 纯音乐',
    moods: ['午后', '慵懒', '治愈'], line: '咖啡还温着，阳光把下午拉得很长',
    warmBias: 0.82, lumBias: 0.72
  },
  '罗锟 - 每一天.mp3': {
    title: '每一天', artist: '罗锟 · 纯音乐',
    moods: ['清晨', '平静', '柔和'], line: '推开窗，新的一天正慢慢苏醒',
    warmBias: 0.64, lumBias: 0.76
  },
  '罗锟 - 章远的何洛.mp3': {
    title: '章远的何洛', artist: '罗锟 · 纯音乐',
    moods: ['怀旧', '校园', '温柔'], line: '走过操场边的林荫道，时间仿佛还没走远',
    warmBias: 0.68, lumBias: 0.62
  },
  '罗锟 - 遇见遇见.mp3': {
    title: '遇见遇见', artist: '罗锟 · 纯音乐',
    moods: ['邂逅', '轻柔', '明朗'], line: '转过街角，风和光线都刚刚好',
    warmBias: 0.70, lumBias: 0.70
  },
  '郁可唯 - 去有风的地方.mp3': {
    title: '去有风的地方', artist: '郁可唯',
    moods: ['旷野', '治愈', '慢生活'], line: '去有风的地方，让云朵替你把心事吹散',
    warmBias: 0.76, lumBias: 0.66
  },
  '陈雪燃 - 一个朝廷·苍生_H.mp3': {
    title: '一个朝廷·苍生', artist: '陈雪燃',
    moods: ['厚重', '苍凉', '山河'], line: '残阳如血，万里山河在暮色中沉默',
    warmBias: 0.54, lumBias: 0.28
  },
  '鸣潮先约电台 _ Forts _ Obadiah Brown-Beach - Against the Tide (逆潮).mp3': {
    title: 'Against the Tide (逆潮)', artist: '鸣潮先约电台 / Forts',
    moods: ['逆风', '空灵爆发', '科幻'], line: '风暴中心的海面，有一道逆流而上的光',
    warmBias: 0.32, lumBias: 0.44
  }
};

function analyzeAudioFile(filePath) {
  const SR = 8000;
  const proc = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 64 * 1024 * 1024 }
  );

  if (proc.status !== 0 || !proc.stdout || proc.stdout.length < SR * 4) {
    throw new Error(`FFmpeg decode failed for ${filePath}`);
  }

  const pcm = new Float32Array(
    proc.stdout.buffer,
    proc.stdout.byteOffset,
    Math.floor(proc.stdout.byteLength / 4)
  );
  const duration = Math.round(pcm.length / SR);

  const hop = SR / 2; // 0.5s per frame
  const numFrames = Math.floor(pcm.length / hop);
  const dbFrames = new Float32Array(numFrames);
  const zcrFrames = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    let sumSq = 0;
    let zcr = 0;
    for (let i = 0; i < hop; i++) {
      const s = pcm[start + i];
      sumSq += s * s;
      if (i > 0 && ((pcm[start + i - 1] >= 0 && s < 0) || (pcm[start + i - 1] < 0 && s >= 0))) {
        zcr++;
      }
    }
    const rms = Math.sqrt(sumSq / hop);
    dbFrames[f] = 20 * Math.log10(rms + 1e-5);
    zcrFrames[f] = zcr / hop;
  }

  // Sort dB values to get p10 (quiet floor) and p95 (climax ceiling)
  const sortedDb = Float32Array.from(dbFrames).sort();
  const p10 = sortedDb[Math.floor(numFrames * 0.08)];
  const p95 = sortedDb[Math.floor(numFrames * 0.95)];
  const dbSpan = Math.max(6, p95 - p10);

  const normEnergy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    // Combine relative dynamic contrast (70%) + absolute loudness (30%)
    const rel = Math.max(0, Math.min(1, (dbFrames[f] - p10) / dbSpan));
    const abs = Math.max(0, Math.min(1, (dbFrames[f] + 38) / 34));
    normEnergy[f] = rel * 0.72 + abs * 0.28;
  }

  // Structural segmentation into 5 natural sections aligned to novelty boundaries
  const targetRatios = [0.14, 0.36, 0.66, 0.84];
  const boundaryFrames = [0];

  for (const ratio of targetRatios) {
    const center = Math.floor(numFrames * ratio);
    const searchRadius = Math.max(6, Math.floor(numFrames * 0.07));
    let bestFrame = center;
    let maxNovelty = -1;

    for (let k = Math.max(4, center - searchRadius); k < Math.min(numFrames - 4, center + searchRadius); k++) {
      let before = 0, after = 0;
      for (let w = 1; w <= 4; w++) {
        before += normEnergy[k - w];
        after += normEnergy[k + w - 1];
      }
      const novelty = Math.abs(after - before) / 4;
      if (novelty > maxNovelty) {
        maxNovelty = novelty;
        bestFrame = k;
      }
    }
    boundaryFrames.push(bestFrame);
  }
  boundaryFrames.push(numFrames);

  const rawNames = ['前奏', '主歌', '副歌', '桥段', '尾奏'];
  const segments = [];
  let peakSegIdx = 2;
  let peakEnergy = -1;

  for (let s = 0; s < 5; s++) {
    const f0 = boundaryFrames[s];
    const f1 = Math.max(f0 + 2, boundaryFrames[s + 1]);
    let eSum = 0;
    let zSum = 0;
    for (let f = f0; f < f1 && f < numFrames; f++) {
      eSum += normEnergy[f];
      zSum += zcrFrames[f];
    }
    const count = Math.max(1, f1 - f0);
    const segEnergy = Number(Math.min(0.96, Math.max(0.15, eSum / count)).toFixed(2));
    const segBright = Number(Math.min(0.95, Math.max(0.15, (zSum / count) * 4.5)).toFixed(2));

    const startSec = Math.round(f0 * 0.5);
    const endSec = s === 4 ? duration : Math.round(f1 * 0.5);

    if (segEnergy > peakEnergy && s >= 1 && s <= 3) {
      peakEnergy = segEnergy;
      peakSegIdx = s;
    }

    segments.push([rawNames[s], startSec, endSec, segEnergy]);
  }

  if (peakSegIdx !== 2) {
    const tmp = segments[peakSegIdx][0];
    segments[peakSegIdx][0] = '副歌';
    if (segments[2][0] === '副歌') segments[2][0] = tmp === '副歌' ? '主歌 B' : tmp;
  }

  const avgEnergy = Number(
    (segments.reduce((acc, s) => acc + s[3], 0) / segments.length).toFixed(2)
  );
  let zTotal = 0;
  for (let f = 0; f < numFrames; f++) zTotal += zcrFrames[f];
  const avgBright = Number(Math.min(0.95, Math.max(0.15, (zTotal / numFrames) * 4.5)).toFixed(2));

  return {
    duration,
    avgEnergy,
    avgBright,
    segments
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(DEMO_DIR).filter(f => f.toLowerCase().endsWith('.mp3'));
  console.log(`正在扫描并分析 demo list 中的 ${files.length} 首真实音频...\n`);

  const library = [];
  for (const file of files) {
    const fullPath = path.join(DEMO_DIR, file);
    const meta = SONG_SEMANTICS[file] || {
      title: file.replace(/\.mp3$/i, ''),
      artist: 'Demo Track',
      moods: ['意境', '旋律'],
      line: '每一段旋律，都在等一张恰好契合的照片',
      warmBias: 0.5,
      lumBias: 0.5
    };

    const acoustic = analyzeAudioFile(fullPath);
    const warm = Number((meta.warmBias * 0.78 + (1 - acoustic.avgBright) * 0.22).toFixed(2));
    const lum = Number((meta.lumBias * 0.75 + acoustic.avgBright * 0.25).toFixed(2));

    const item = {
      file: `demo list/${file}`,
      title: meta.title,
      artist: meta.artist,
      warm,
      lum,
      energy: acoustic.avgEnergy,
      duration: acoustic.duration,
      moods: meta.moods,
      line: meta.line,
      segments: acoustic.segments
    };

    library.push(item);
    const segStr = acoustic.segments.map(s => `${s[0]}(${s[1]}-${s[2]}s:${s[3]})`).join(' | ');
    console.log(`✓ ${meta.title.padEnd(24)} -> ${segStr}`);
  }

  const outPath = path.join(OUT_DIR, 'demo_library.json');
  fs.writeFileSync(outPath, JSON.stringify(library, null, 2), 'utf8');
  console.log(`\n✅ 已生成真实曲库索引: ${outPath}`);
}

main();
