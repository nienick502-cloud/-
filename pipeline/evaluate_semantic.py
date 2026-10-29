"""用同一批本地照片对比现有规则与真实语义推理，生成可试听的中文报告。"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone, timedelta
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def color_features(image: Image.Image) -> dict:
    """与页面同公式；缩图为 Pillow 双线性，不能声称逐像素等同 Canvas。"""
    pixels = np.asarray(image.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR), dtype=np.float64)
    maximum, minimum = pixels.max(axis=2), pixels.min(axis=2)
    luminance = (pixels[:, :, 0] * 0.299 + pixels[:, :, 1] * 0.587 + pixels[:, :, 2] * 0.114) / 255
    saturation = np.divide(maximum - minimum, maximum, out=np.zeros_like(maximum), where=maximum != 0)
    return {
        "lum": float(luminance.mean()),
        "sat": float(saturation.mean()),
        "contrast": float(np.abs(luminance - 0.5).mean()),
        "warm": float(np.clip(((pixels[:, :, 0] - pixels[:, :, 2]).mean() / 255 + 0.25) / 0.5, 0, 1)),
    }


def baseline_rankings(features: list[dict], root: Path = ROOT) -> list[list[dict]]:
    """直接执行页面中的原始排序函数，避免维护第二份旧算法。"""
    javascript = r"""
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[1], 'utf8');
const match = html.match(/function matchLibrary\(features\) \{[\s\S]*?\n\}/);
if (!match) throw new Error('页面中未找到基线 matchLibrary 函数');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const LIBRARY = payload.library;
eval(match[0]);
process.stdout.write(JSON.stringify(payload.features.map(matchLibrary)));
"""
    library = json.loads((root / "data/demo_library.json").read_text(encoding="utf-8"))
    completed = subprocess.run(
        ["node", "-e", javascript, str(root / "index.html")],
        input=json.dumps({"library": library, "features": features}, ensure_ascii=False),
        text=True, encoding="utf-8", capture_output=True, check=True,
    )
    return json.loads(completed.stdout)


def distribution(rows: list[dict], method: str, library: list[dict]) -> dict:
    first = Counter(row[method][0]["songIndex"] for row in rows)
    top_three = Counter(item["songIndex"] for row in rows for item in row[method][:3])
    total = len(rows)
    probabilities = [value / total for value in first.values()] if total else []
    hhi = sum(p * p for p in probabilities)
    orange_index = next((i for i, song in enumerate(library) if song["title"] == "橘子花火"), None)
    warm = [row for row in rows if row["color"]["warm"] >= 0.8]
    return {
        "images": total,
        "top1_unique": len(first),
        "top3_unique": len(top_three),
        "top1_coverage": len(first) / len(library) if library else 0,
        "top3_coverage": len(top_three) / len(library) if library else 0,
        "max_song_count": max(first.values(), default=0),
        "max_song_share": max(probabilities, default=0),
        "hhi": hhi,
        "effective_songs": 1 / hhi if hhi else 0,
        "entropy_effective_songs": math.exp(-sum(p * math.log(p) for p in probabilities)) if probabilities else 0,
        "warm_images": len(warm),
        "warm_orange_top1": sum(row[method][0]["songIndex"] == orange_index for row in warm),
        "counts": [
            {"songIndex": i, "title": song["title"], "artist": song["artist"], "top1": first[i], "top3": top_three[i]}
            for i, song in enumerate(library)
        ],
    }


def safe_script_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def report_html(report: dict) -> str:
    # 对照试听须看到整张照片，避免卡片裁切隐藏判断所需的主体。
    template = HTML_TEMPLATE.replace("object-fit:cover", "object-fit:contain")
    return template.replace("__REPORT_DATA__", safe_script_json(report))


def write_report(report: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "index.html").write_text(report_html(report), encoding="utf-8")
    old, new = report["metrics"]["baseline"], report["metrics"]["semantic"]
    lines = [
        "# 照片语义匹配对照", "",
        f"生成时间：{report['created_at']}。成功配对图片 {len(report['rows'])} / {report['source_images']} 张；曲库 {len(report['library'])} 首。", "",
        "| 指标 | 旧色彩规则 | 本地语义方案 |", "| :--- | ---: | ---: |",
        f"| 首选覆盖歌曲数 | {old['top1_unique']} | {new['top1_unique']} |",
        f"| 前三候选覆盖歌曲数 | {old['top3_unique']} | {new['top3_unique']} |",
        f"| 单首歌最多首选次数 | {old['max_song_count']} | {new['max_song_count']} |",
        f"| 单首歌最高占比 | {old['max_song_share']:.1%} | {new['max_song_share']:.1%} |",
        f"| 首选集中度 HHI（越小越分散） | {old['hhi']:.4f} | {new['hhi']:.4f} |",
        f"| 有效歌曲数（1 / HHI） | {old['effective_songs']:.2f} | {new['effective_songs']:.2f} |",
        f"| 高暖色图片中首选《橘子花火》 | {old['warm_orange_top1']} / {old['warm_images']} | {new['warm_orange_top1']} / {new['warm_images']} |", "",
        f"首选歌曲改变的图片：{report['changed_top1']} 张。", "",
        "## 方法与限制", "",
        *[f"- {note}" for note in report["notes"]], "",
        "## 首选未覆盖的歌曲", "",
        "旧方案：" + "、".join(item["title"] for item in old["counts"] if not item["top1"]), "",
        "新方案：" + "、".join(item["title"] for item in new["counts"] if not item["top1"]), "",
        "逐图对照和段落试听见同目录 index.html，完整原始结果见 results.json。", "",
    ]
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")


HTML_TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>身临其境 · 新旧匹配对照</title><style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#1d1d1f;background:#f5f5f7}*{box-sizing:border-box}body{margin:0;padding:44px 28px 145px}main{max-width:1240px;margin:auto}h1{font-size:34px;letter-spacing:-1px;font-weight:600;margin:8px 0 14px}h2{font-size:21px;font-weight:600}.eyebrow{font-size:12px;letter-spacing:3px;color:#6e6e73}p{line-height:1.7}.muted,small{color:#6e6e73}a{color:inherit}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:11px 12px;border-bottom:1px solid rgba(0,0,0,.08);text-align:left}th{color:#6e6e73;font-weight:500}.summary{background:#fff;border-radius:16px;padding:18px 22px;margin:28px 0}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:26px 0 12px;position:sticky;top:0;z-index:2;background:#f5f5f7ee;padding:12px 0;backdrop-filter:blur(14px)}input,select,button{font:inherit;font-size:13px;border:1px solid #ddd;border-radius:8px;padding:10px 12px;background:#fff;color:#1d1d1f}input[type=search]{flex:1;min-width:200px}input[type=checkbox]{margin-right:6px}button{cursor:pointer}button:hover{background:#efeff1}button:disabled{opacity:.4;cursor:default}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.card{background:#fff;border-radius:13px;overflow:hidden;border:1px solid rgba(0,0,0,.05)}.card img{width:100%;height:210px;object-fit:cover;display:block;background:#e7e7eb}.detail{padding:16px}.filename{font-size:10px;line-height:1.5;overflow-wrap:anywhere;color:#8a8a90;margin:0 0 12px}.concepts{font-size:12px;color:#777;min-height:32px;margin-bottom:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.method{font-size:12px;color:#8a8a90;letter-spacing:.5px;margin-bottom:10px}.candidate{font-size:12px;line-height:1.5;margin-bottom:12px}.candidate strong{display:block;font-weight:500;min-height:36px}.candidate button{padding:5px 8px;margin-top:5px;font-size:11px}.badge{font-size:10px;color:#777;margin:10px 0 0}.pagination{display:flex;justify-content:center;align-items:center;gap:18px;margin:24px 0}.player{position:fixed;bottom:0;left:0;right:0;background:#fffffff2;backdrop-filter:blur(18px);border-top:1px solid #e5e5e5;padding:15px 28px;z-index:5}.player-inner{max-width:1240px;margin:auto;display:flex;align-items:center;gap:22px}.player-label{flex:1;font-size:13px;line-height:1.6}audio{width:min(460px,50vw);height:38px}details{font-size:13px;line-height:1.7;color:#6e6e73}details summary{cursor:pointer}ul{padding-left:20px}.song-table{max-height:400px;overflow:auto}.notice{font-size:13px;color:#6e6e73}label{font-size:13px}.error{color:#a22}@media(max-width:950px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){body{padding:28px 15px 180px}.grid{grid-template-columns:1fr}.player-inner{display:block}audio{width:100%;margin-top:8px}.summary{padding:12px 8px}th,td{padding:9px 7px;font-size:12px}h1{font-size:29px}}
</style></head><body><main>
<div class="eyebrow">IMMERSION / 本地实验</div><h1>同一张照片，两种倾听方式。</h1>
<p class="muted" id="subtitle"></p><p class="notice">这里比较推荐分布和具体候选。分布更分散并不自动意味着音乐更契合；请结合照片试听判断。</p>
<section class="summary"><table><thead><tr><th>观察项</th><th>旧色彩规则</th><th>本地语义匹配</th></tr></thead><tbody id="metrics"></tbody></table></section>
<details><summary>方法、运行信息与局限</summary><ul id="notes"></ul><p id="identity"></p></details>
<details style="margin-top:15px"><summary>查看全部歌曲的覆盖次数</summary><div class="song-table"><table><thead><tr><th>歌曲</th><th>旧首选</th><th>新首选</th><th>旧前三</th><th>新前三</th></tr></thead><tbody id="songs"></tbody></table></div></details>
<div class="toolbar"><input id="search" type="search" placeholder="搜索图片、歌曲或意境" aria-label="搜索图片、歌曲或意境"><select id="song" aria-label="按歌曲筛选"><option value="">全部歌曲</option></select><label><input id="changed" type="checkbox">只看首选改变</label><label><input id="warm" type="checkbox">高暖色图片</label></div>
<p class="muted" id="count"></p><div class="grid" id="cards"></div><div class="pagination"><button id="prev">上一页</button><span id="page"></span><button id="next">下一页</button></div>
</main><div class="player"><div class="player-inner"><div class="player-label" id="playerLabel">选择任一候选，试听对应音乐段落。<br><small>播放依赖本机 demo list 音频文件。</small></div><audio id="audio" controls preload="none"></audio></div></div>
<script id="report-data" type="application/json">__REPORT_DATA__</script><script>
const D=JSON.parse(document.getElementById('report-data').textContent);
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const url=p=>p.split('/').map(encodeURIComponent).join('/');
const A=D.metrics.baseline,B=D.metrics.semantic;
$('subtitle').textContent=`${D.rows.length} 张配对照片 · ${D.library.length} 首歌曲 · ${D.changed_top1} 张照片的首选歌曲发生变化`;
const metrics=[['首选覆盖歌曲数',A.top1_unique,B.top1_unique],['前三候选覆盖歌曲数',A.top3_unique,B.top3_unique],['单首歌最多首选次数',A.max_song_count,B.max_song_count],['单首歌最高占比',(A.max_song_share*100).toFixed(1)+'%',(B.max_song_share*100).toFixed(1)+'%'],['首选集中度 HHI（越小越分散）',A.hhi.toFixed(4),B.hhi.toFixed(4)],['有效歌曲数（1 / HHI）',A.effective_songs.toFixed(2),B.effective_songs.toFixed(2)],['高暖色图片首选《橘子花火》',`${A.warm_orange_top1} / ${A.warm_images}`,`${B.warm_orange_top1} / ${B.warm_images}`]];
$('metrics').innerHTML=metrics.map(r=>'<tr>'+r.map(v=>`<td>${esc(v)}</td>`).join('')+'</tr>').join('');
$('notes').innerHTML=D.notes.map(n=>`<li>${esc(n)}</li>`).join('');
$('identity').textContent=`生成于 ${D.created_at}；实际设备 ${D.device}；视觉推理/缓存处理总耗时 ${D.elapsed_seconds.toFixed(1)} 秒；缓存命中 ${D.cache_hits} 张。`;
$('songs').innerHTML=D.library.map((s,i)=>`<tr><td>${esc(s.title)}</td><td>${A.counts[i].top1}</td><td>${B.counts[i].top1}</td><td>${A.counts[i].top3}</td><td>${B.counts[i].top3}</td></tr>`).join('');
D.library.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.title;$('song').appendChild(o)});
let page=0,shown=[],activeToken=0,bounds=null;const pageSize=24,audio=$('audio');
function filterRows(){const q=$('search').value.trim().toLowerCase(),song=$('song').value;shown=D.rows.filter(r=>{
 if($('changed').checked&&r.baseline[0].songIndex===r.semantic[0].songIndex)return false;
 if($('warm').checked&&r.color.warm<.8)return false;
 const picks=[...r.baseline,...r.semantic];
 if(song!==''&&!picks.some(p=>p.songIndex===Number(song)))return false;
 return !q||[r.file,...r.concepts.map(c=>c.label),...picks.map(p=>D.library[p.songIndex].title)].join(' ').toLowerCase().includes(q);
});page=0;render()}
function candidates(r,method){return r[method].map((p,k)=>{const s=D.library[p.songIndex],seg=s.segments[p.segIndex];return `<div class="candidate"><strong>${k+1}. ${esc(s.title)}</strong><small>${esc(seg[0])} · ${fmt(seg[1])}–${fmt(seg[2])}</small><br><button data-row="${r.id}" data-method="${method}" data-pick="${k}">试听这一段</button></div>`}).join('')}
function render(){const pages=Math.max(1,Math.ceil(shown.length/pageSize));page=Math.min(page,pages-1);$('count').textContent=`符合条件 ${shown.length} 张`;$('page').textContent=`${page+1} / ${pages}`;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
 $('cards').innerHTML=shown.slice(page*pageSize,(page+1)*pageSize).map(r=>`<article class="card"><img loading="lazy" src="${esc(url(D.root_relative+'/'+r.file))}" alt="${esc(r.file.split('/').pop())}"><div class="detail"><p class="filename">${esc(r.file.split('/').pop())}</p><div class="concepts">模型意境候选：${r.concepts.map(c=>esc(c.label)).join(' · ')}</div><div class="pair"><div><div class="method">旧 · 色彩规则</div>${candidates(r,'baseline')}</div><div><div class="method">新 · 本地语义</div>${candidates(r,'semantic')}</div></div><div class="badge">${r.baseline[0].songIndex===r.semantic[0].songIndex?'首选歌曲一致':'首选歌曲改变'} · 暖色值 ${r.color.warm.toFixed(2)}</div></div></article>`).join('');
}
for(const id of ['search','song','changed','warm'])$(id).addEventListener(id==='search'?'input':'change',filterRows);
$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};
$('cards').onclick=async e=>{const button=e.target.closest('button[data-row]');if(!button)return;const token=++activeToken;audio.pause();bounds=null;
 const r=D.rows.find(x=>x.id===Number(button.dataset.row)),p=r[button.dataset.method][Number(button.dataset.pick)],song=D.library[p.songIndex],seg=song.segments[p.segIndex];
 $('playerLabel').textContent=`${button.dataset.method==='baseline'?'旧色彩规则':'本地语义'} · ${song.title} · ${seg[0]} ${fmt(seg[1])}–${fmt(seg[2])}`;
 const source=url(D.root_relative+'/'+song.file);audio.src=source;
 audio.onloadedmetadata=async()=>{if(token!==activeToken)return;bounds=[seg[1],seg[2]];audio.currentTime=seg[1];try{await audio.play()}catch(error){if(token===activeToken)$('playerLabel').textContent+=' · 点击播放器播放按钮继续'}};
 audio.onerror=()=>{if(token===activeToken)$('playerLabel').textContent+=' · 无法读取本地音频，请检查 demo list 文件'};audio.load();
};
audio.addEventListener('timeupdate',()=>{if(bounds&&audio.currentTime>=bounds[1])audio.pause()});
audio.addEventListener('play',()=>{if(bounds&&(audio.currentTime<bounds[0]||audio.currentTime>=bounds[1]))audio.currentTime=bounds[0]});
filterRows();
</script></body></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/semantic-comparison")
    parser.add_argument("--limit", type=int, help="仅用于冒烟测试；报告会明确标注为子集")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit 必须大于 0")
    from server.semantic import SemanticMatcher

    output = args.output.resolve()
    library = json.loads((ROOT / "data/demo_library.json").read_text(encoding="utf-8"))
    paths = sorted(p for p in (ROOT / "picture").iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
    source_count = len(paths)
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        raise RuntimeError("picture 中没有可评测图片")
    print("加载本地视觉模型和音乐语义索引……", flush=True)
    matcher = SemanticMatcher(root=ROOT, device=args.device)
    matcher.load_index()
    matcher.ensure_vision()
    model_path = ROOT / "model/chinese-clip-vit-base-patch16/pytorch_model.bin"
    identity = {
        "visual_weights_sha256": sha256_file(model_path),
        "visual_config_sha256": {p.name: sha256_file(p) for p in sorted(model_path.parent.iterdir())
                                 if p.suffix in {".json", ".txt"}},
        "anchors_sha256": sha256_file(ROOT / "server/anchors.json"),
        "implementation_sha256": sha256_file(ROOT / "server/semantic.py"),
        "transformers": importlib.metadata.version("transformers"),
        "pillow": importlib.metadata.version("Pillow"),
        "torch": importlib.metadata.version("torch"),
        "device": matcher.device,
    }
    fingerprint = json.dumps(identity, sort_keys=True).encode()
    cache_dir = ROOT / "data/.semantic_eval_cache"
    cache_dir.mkdir(exist_ok=True)
    rows, failures = [], []
    cache_hits = 0
    start = time.perf_counter()
    for n, path in enumerate(paths, 1):
        relative = path.relative_to(ROOT).as_posix()
        try:
            key = hashlib.sha256(fingerprint + path.read_bytes()).hexdigest()
            cache_path = cache_dir / (key + ".npz")
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
                colors = color_features(image)
                features = None
                if cache_path.exists() and not args.no_cache:
                    try:
                        with np.load(cache_path, allow_pickle=False) as saved:
                            features = {k: saved[k] for k in saved.files}
                        if not {"embedding", "profile"}.issubset(features) or not all(np.isfinite(v).all() for v in features.values()):
                            features = None
                    except (OSError, ValueError):
                        features = None
                if features is None:
                    features = matcher.image_features(image)
                    temporary = cache_path.with_suffix(".tmp.npz")
                    np.savez_compressed(temporary, **features)
                    temporary.replace(cache_path)
                else:
                    cache_hits += 1
            prediction = matcher.rank_features(features)
            if len(prediction["ranked"]) < min(3, len(library)):
                raise ValueError("语义结果候选不足，无法进行相同口径对照")
            rows.append({"id": len(rows), "file": relative, "sha256": sha256_file(path), "color": colors,
                         "semantic": prediction["ranked"][:3], "concepts": prediction["concepts"][:3]})
            title = library[prediction["ranked"][0]["songIndex"]]["title"]
            print(f"[{n}/{len(paths)}] {path.name} -> {title}", flush=True)
        except Exception as exc:
            failures.append({"file": relative, "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{n}/{len(paths)}] 失败 {path.name}: {exc}", file=sys.stderr, flush=True)
    if not rows:
        raise RuntimeError(f"所有图片处理失败：{failures[:3]}")
    old_rankings = baseline_rankings([row["color"] for row in rows])
    for row, ranking in zip(rows, old_rankings, strict=True):
        row["baseline"] = ranking[:3]
    notes = [
        "旧方案直接调用当前 index.html 的 matchLibrary；颜色特征按同公式由 Pillow 双线性缩至 64×64 计算，与浏览器 Canvas 缩图可能有少量差异。",
        "新方案实际运行本地 Chinese-CLIP，音乐索引来自真实段落 CLAP 推理；成对意境描述和歌曲元数据是显式人工先验，模型相似度不是情绪概率或匹配准确率。",
        "两套方案在同一批成功处理的图片上统计。高暖色子集定义为旧特征 warm ≥ 0.8。首选与前三覆盖按不同歌曲计数。",
        "HHI 为各歌曲首选占比平方之和；有效歌曲数为 1 / HHI。覆盖率和集中度不能单独证明听感提升，也不要求 33 首歌平均出现。",
        "这些图片已用于问题诊断，属于开发集，不是独立测试集。未做人工盲听标注，不报告准确率或显著性。后续需另留新照片验证。",
        "本轮不根据图片文件名推荐，不加入随机换歌、会话曝光惩罚或强制均匀分配；两种方案沿用相同音乐段落起止时间。",
        "段落仍是已有声学规则切分；此实验没有验证曲式标签准确性。网页试听需本机音频，公开分享须另行确认素材授权。",
    ]
    if args.limit:
        notes.append(f"这是 --limit {args.limit} 产生的冒烟测试子集，不能当作全量 {source_count} 张图片结果。")
    if failures:
        notes.append(f"有 {len(failures)} 张图片失败，已从两侧统计同时排除；详见 results.json failures。")
    metadata_path = ROOT / "data/semantic_library.meta.json"
    report = {
        "schema_version": 1,
        "created_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "source_images": source_count,
        "requested_images": len(paths),
        "device": str(getattr(matcher, "device", args.device)),
        "elapsed_seconds": time.perf_counter() - start,
        "cache_hits": cache_hits,
        "identity": identity,
        "semantic_recipe": {key: prediction.get(key) for key in ("method", "model_names", "weights", "score_kind")},
        "audio_index_metadata": json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else None,
        "root_relative": Path(os.path.relpath(ROOT, output)).as_posix(),
        "library": library,
        "metrics": {method: distribution(rows, method, library) for method in ("baseline", "semantic")},
        "changed_top1": sum(row["baseline"][0]["songIndex"] != row["semantic"][0]["songIndex"] for row in rows),
        "notes": notes,
        "failures": failures,
        "rows": rows,
    }
    write_report(report, output)
    print(json.dumps({"output": str(output / "index.html"), "paired_images": len(rows), "failures": len(failures),
                      "baseline_top1_unique": report["metrics"]["baseline"]["top1_unique"],
                      "semantic_top1_unique": report["metrics"]["semantic"]["top1_unique"]}, ensure_ascii=False), flush=True)
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
