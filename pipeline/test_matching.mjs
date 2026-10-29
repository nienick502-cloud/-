import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIBRARY = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo_library.json'), 'utf8'));

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function matchLibrary(features) {
  const targetEnergy = Math.min(0.95, Math.max(0.22, features.sat * 0.78 + features.contrast * 0.65 + 0.18));

  return LIBRARY.map((song, i) => {
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
}

const TEST_PHOTOS = [
  { name: '测试场景1：海边金色落日与晚霞 (暖色温、中高明度、高饱和)', warm: 0.78, lum: 0.62, sat: 0.72, contrast: 0.28 },
  { name: '测试场景2：赛博雨夜街头霓虹 (冷色温、暗调、高反差)', warm: 0.28, lum: 0.28, sat: 0.68, contrast: 0.34 },
  { name: '测试场景3：冬日清晨初雪旷野 (极冷色温、高明度、低饱和)', warm: 0.22, lum: 0.82, sat: 0.28, contrast: 0.22 },
  { name: '测试场景4：午后温暖咖啡馆阳光 (暖色温、柔和中明度、低反差)', warm: 0.74, lum: 0.66, sat: 0.40, contrast: 0.16 },
  { name: '测试场景5：雨天窗边静谧夜色 (偏冷色温、中低明度、柔和)', warm: 0.36, lum: 0.44, sat: 0.48, contrast: 0.20 }
];

console.log('================================================================');
console.log('  身临其境 · demo list (33首真实音频) 段落级检索匹配测试报告');
console.log('================================================================\n');

for (const photo of TEST_PHOTOS) {
  const ranked = matchLibrary(photo);
  console.log(`📷 ${photo.name}`);
  console.log(`   图像特征: 色温=${photo.warm} | 明度=${photo.lum} | 饱和度=${photo.sat}`);
  ranked.slice(0, 3).forEach((r, idx) => {
    const s = LIBRARY[r.songIndex];
    const seg = s.segments[r.segIndex];
    const badge = idx === 0 ? '🎯 [首选命中]' : `   [候选 #${idx + 1}]`;
    console.log(
      `   ${badge} 《${s.title}》(${s.artist}) -> 切入段落: 【${seg[0]} ${fmt(seg[1])}–${fmt(seg[2])}】(段落能量 ${seg[3]})`
    );
  });
  console.log('');
}
