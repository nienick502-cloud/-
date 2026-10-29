/**
 * 身临其境 (Immersion) — 核心开源小模型一键下载与校验脚本
 * 下载目录：d:\AI_agent_workflow\身临其境\model\
 * 包含模型：
 *   1. allin1 (taejunkim/allinone) — 音乐曲式结构切分模型 (前奏/主歌/副歌/桥段/尾奏)
 *   2. Chinese-CLIP (OFA-Sys/chinese-clip-vit-base-patch16) — 中文跨模态视觉意境零样本模型
 *   3. 历史目录 EmoSet-ViT (jihedjabnoun/vit-face-emotion-recognition) — 人脸表情模型，不用于风景意境
 *   4. LAION-CLAP (laion/clap-htsat-unfused) — 音乐段落特征提取与跨模态对齐模型
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HF_ENDPOINTS = [
  'https://hf-mirror.com',
  'https://huggingface.co'
];

const MODELS = [
  {
    name: 'allin1 (音乐曲式结构切分模型)',
    repo: 'taejunkim/allinone',
    localDir: path.join(__dirname, 'allin1'),
    filter: (f) => f === 'README.md' || f.startsWith('harmonix-fold')
  },
  {
    name: 'Chinese-CLIP-ViT-B-16 (视觉意境模型)',
    repo: 'OFA-Sys/chinese-clip-vit-base-patch16',
    localDir: path.join(__dirname, 'chinese-clip-vit-base-patch16'),
    // Skip duplicate clip_cn_vit-b-16.pt since pytorch_model.bin is standard HuggingFace Transformers format
    filter: (f) => f !== 'clip_cn_vit-b-16.pt' && !f.startsWith('.git')
  },
  {
    name: '人脸表情识别模型 (历史目录 emoset-vit，不用于风景意境)',
    repo: 'jihedjabnoun/vit-face-emotion-recognition',
    localDir: path.join(__dirname, 'emoset-vit'),
    filter: (f) => !f.startsWith('.git')
  },
  {
    name: 'LAION-CLAP (音频段落跨模态向量模型)',
    repo: 'laion/clap-htsat-unfused',
    localDir: path.join(__dirname, 'clap-htsat-unfused'),
    filter: (f) => !f.startsWith('.git') && !f.endsWith('.h5') && !f.endsWith('.ot')
  }
];

async function fetchWithFallback(urlPath, options = {}) {
  let lastErr = null;
  for (const base of HF_ENDPOINTS) {
    const url = `${base}${urlPath}`;
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'Immersion-Model-Downloader/1.0',
          ...(options.headers || {})
        },
        redirect: 'follow'
      });
      if (res.ok) {
        return { res, base };
      }
      lastErr = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function listRepoFiles(repo) {
  const { res } = await fetchWithFallback(`/api/models/${repo}`);
  const info = await res.json();
  return (info.siblings || []).map(s => s.rfilename);
}

async function downloadFile(repo, rfilename, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 0) {
      console.log(`  [已存在，跳过] ${rfilename} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
      return;
    }
  }

  const encodedPath = rfilename.split('/').map(encodeURIComponent).join('/');
  const urlPath = `/${repo}/resolve/main/${encodedPath}`;
  const { res, base } = await fetchWithFallback(urlPath);

  const totalBytes = Number(res.headers.get('content-length') || 0);
  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(`  ↓ 正在下载 ${rfilename} (${totalBytes ? totalMB + ' MB' : '未知大小'}) [源: ${base}]`);

  const tmpPath = `${destPath}.part`;
  const fileStream = fs.createWriteStream(tmpPath);

  let downloaded = 0;
  let lastLog = Date.now();

  const reader = res.body.getReader();
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        downloaded += value.byteLength;
        const now = Date.now();
        if (now - lastLog > 3000 && totalBytes > 0) {
          const pct = ((downloaded / totalBytes) * 100).toFixed(1);
          const curMB = (downloaded / 1024 / 1024).toFixed(1);
          console.log(`    ... ${rfilename}: ${pct}% (${curMB} / ${totalMB} MB)`);
          lastLog = now;
        }
        this.push(Buffer.from(value));
      }
    }
  });

  await finished(nodeStream.pipe(fileStream));
  fs.renameSync(tmpPath, destPath);
  console.log(`  ✓ 完成 ${rfilename} (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
}

async function main() {
  const mode = process.argv[2] || 'all';
  for (const m of MODELS) {
    console.log(`\n========================================`);
    console.log(`模型: ${m.name} (${m.repo})`);
    console.log(`目录: ${m.localDir}`);
    console.log(`========================================`);
    fs.mkdirSync(m.localDir, { recursive: true });

    const allFiles = await listRepoFiles(m.repo);
    const selected = allFiles.filter(m.filter);

    for (const f of selected) {
      const isWeight = f.endsWith('.safetensors') || f.endsWith('.bin') || f.endsWith('.pth') || f.endsWith('.pt') || f.endsWith('.ckpt');
      if (mode === 'meta' && isWeight) {
        console.log(`  [待下载权重] ${f}`);
        continue;
      }
      await downloadFile(m.repo, f, path.join(m.localDir, f));
    }
  }
  console.log(`\n🎉 全部模型及权重文件下载完毕！`);
}

main().catch(err => {
  console.error('下载出错:', err);
  process.exit(1);
});
