"""本地跨模态意境检索。

Chinese-CLIP 与 CLAP 的原始向量不相互比较；两侧分别投影到人工定义的
40 个意境描述上，再比较中心化的意境相似度轮廓。第一版固定评分为
0.65 * 音频意境轮廓余弦 + 0.35 * 视觉/人工歌曲意境描述相似度的标准化值。
分数越大越相关，不是概率；不使用颜色、历史曝光或随机换歌。
现有段落边界仍来自启发式切段，不代表模型识别了真实主歌/副歌结构。
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from typing import Callable

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
VISUAL_MODEL = "OFA-Sys/chinese-clip-vit-base-patch16"
AUDIO_MODEL = "laion/clap-htsat-unfused"
INDEX_VERSION = "semantic-v1"
WINDOW_SECONDS = 10.0
SAMPLE_RATE = 48000
WINDOWS_PER_SEGMENT = 2


def normalize(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-8)


def semantic_profile(scores: np.ndarray) -> np.ndarray:
    scores = np.asarray(scores, dtype=np.float32)
    return normalize(scores - scores.mean(axis=-1, keepdims=True))


def window_starts(start: float, end: float, count: int = WINDOWS_PER_SEGMENT) -> list[float]:
    """均匀取段内固定窗；短段仅取一次，不跨越段落边界。"""
    if not np.isfinite([start, end]).all() or start < 0 or end <= start or count < 1:
        raise ValueError("段落起止时间或窗口数量无效")
    last = max(start, end - WINDOW_SECONDS)
    if last == start or count == 1:
        return [float((start + last) / 2)]
    return [float(t) for t in np.linspace(start, last, count)]


def choose_device(requested: str = "auto") -> str:
    import torch

    torch.set_num_threads(min(8, max(1, (os.cpu_count() or 4) // 2)))
    if requested not in {"auto", "cpu", "cuda"}:
        raise ValueError("device 必须为 auto、cpu 或 cuda")
    if requested == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        try:
            # GPU 可见不保证 wheel 包含本显卡架构；实际执行算子并同步。
            a = torch.ones((32, 32), device="cuda")
            (a @ a).sum().item()
            torch.cuda.synchronize()
            return "cuda"
        except (RuntimeError, AssertionError) as exc:
            if requested == "cuda":
                raise RuntimeError("当前 PyTorch 无法在本机 GPU 执行，请使用 cpu 或安装兼容版本") from exc
    elif requested == "cuda":
        raise RuntimeError("未检测到可用 CUDA GPU")
    return "cpu"


def _model_stamp(directory: Path) -> dict:
    """用配置内容及本地权重大小/修改时间识别当前模型，不宣称做过上游哈希校验。"""
    result = {}
    for file in sorted(directory.iterdir()):
        if file.suffix in {".json", ".txt", ".bin", ".safetensors"}:
            stat = file.stat()
            item = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
            if file.suffix in {".json", ".txt"}:
                item["sha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
            result[file.name] = item
    if not any(n.endswith((".bin", ".safetensors")) for n in result):
        raise FileNotFoundError(f"缺少本地模型权重：{directory}")
    return result


def _identity(root: Path, library: list[dict], anchors_bytes: bytes, library_bytes: bytes) -> tuple[str, dict]:
    audio_sources = []
    for song in library:
        file = root / song["file"]
        stat = file.stat()  # 音频缺失时明确报错，不能把不存在音频的索引当成可用曲库。
        audio_sources.append({"file": song["file"], "size": stat.st_size, "mtime_ns": stat.st_mtime_ns})
    identity = {
        "version": INDEX_VERSION,
        "library_sha256": hashlib.sha256(library_bytes).hexdigest(),
        "anchors_sha256": hashlib.sha256(anchors_bytes).hexdigest(),
        "visual_model": _model_stamp(root / "model/chinese-clip-vit-base-patch16"),
        "audio_model": _model_stamp(root / "model/clap-htsat-unfused"),
        "audio_sources": audio_sources,
        "window_seconds": WINDOW_SECONDS,
        "windows_per_segment": WINDOWS_PER_SEGMENT,
        "sample_rate": SAMPLE_RATE,
    }
    encoded = json.dumps(identity, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), identity


def _atomic_npz(path: Path, **arrays) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("wb") as handle:
        np.savez_compressed(handle, **arrays)
    os.replace(temp, path)


def _atomic_json(path: Path, data: dict) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def _feature_tensor(result):
    """兼容 Transformers 4.x 张量输出与新版带 pooler_output 的输出对象。"""
    if hasattr(result, "detach"):
        return result
    if getattr(result, "pooler_output", None) is not None:
        return result.pooler_output
    raise TypeError("模型特征输出格式不受支持")


class SemanticMatcher:
    def __init__(self, root: Path | str = ROOT, device: str = "auto"):
        self.root = Path(root).resolve()
        self.requested_device = device
        self.device = "uninitialized"
        self.library_bytes = (self.root / "data/demo_library.json").read_bytes()
        self.library = json.loads(self.library_bytes)
        self.anchors_bytes = (self.root / "server/anchors.json").read_bytes()
        self.anchors = json.loads(self.anchors_bytes)["concepts"]
        self.index_path = self.root / "data/semantic_library.npz"
        self.meta_path = self.root / "data/semantic_library.meta.json"
        self.visual_model = None
        self.visual_processor = None
        self.index_loaded = False

    def load_index(self, path: Path | str | None = None) -> None:
        # 重新校验失败后不能继续用上一次“已加载”状态或半更新的数组。
        self.index_loaded = False
        if ((self.root / "data/demo_library.json").read_bytes() != self.library_bytes
                or (self.root / "server/anchors.json").read_bytes() != self.anchors_bytes):
            raise ValueError("曲库或意境词表已改变，请重新建库并重启语义服务")
        path = Path(path) if path is not None else self.index_path
        meta_path = path.with_suffix(".meta.json")
        if not path.exists() or not meta_path.exists():
            raise FileNotFoundError("尚未建好语义索引，请运行 python pipeline/build_semantic_index.py")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        expected, _ = _identity(self.root, self.library, self.anchors_bytes, self.library_bytes)
        if not meta.get("ready") or meta.get("fingerprint") != expected:
            raise ValueError("语义索引已过期：曲库、音频、模型或意境词表已改变，请重新建库")
        with np.load(path, allow_pickle=False) as data:
            audio_profiles = data["audio_profiles"].astype(np.float32)
            song_indices = data["song_indices"]
            segment_indices = data["segment_indices"]
        if (song_indices.ndim != 1 or segment_indices.ndim != 1
                or not np.issubdtype(song_indices.dtype, np.integer)
                or not np.issubdtype(segment_indices.dtype, np.integer)):
            raise ValueError("语义索引的歌曲或段落编号格式无效，请重新建库")
        expected_pairs = [(i, k) for i, song in enumerate(self.library) for k in range(len(song["segments"]))]
        actual_pairs = list(zip(song_indices.tolist(), segment_indices.tolist()))
        if (len(song_indices) != len(segment_indices) or actual_pairs != expected_pairs
                or audio_profiles.shape != (len(expected_pairs), len(self.anchors))):
            raise ValueError("语义索引的歌曲或段落顺序不匹配，请重新建库")
        if not np.isfinite(audio_profiles).all():
            raise ValueError("语义索引含非有限数值，请重新建库")
        self.audio_profiles = audio_profiles
        self.song_indices = song_indices.astype(np.int64)
        self.segment_indices = segment_indices.astype(np.int64)
        self.index_meta = meta
        self.index_loaded = True

    def ensure_vision(self) -> None:
        if self.visual_model is not None:
            return
        import torch
        from transformers import ChineseCLIPModel, ChineseCLIPProcessor

        self.device = choose_device(self.requested_device)
        folder = self.root / "model/chinese-clip-vit-base-patch16"
        self.visual_processor = ChineseCLIPProcessor.from_pretrained(folder, local_files_only=True, use_fast=False)
        self.visual_model = ChineseCLIPModel.from_pretrained(folder, local_files_only=True).eval().to(self.device)
        prompts = [a["visual"] for a in self.anchors]
        # 仅用已有人工意境标签与诗意描述作辅助，歌名不作为图像语义，避免“橘子”字面偏置。
        prompts += ["一张表现" + "、".join(s["moods"]) + "氛围的照片。" + s["line"] for s in self.library]
        vectors = []
        with torch.inference_mode():
            for i in range(0, len(prompts), 16):
                inputs = self.visual_processor(text=prompts[i:i+16], return_tensors="pt", padding=True, truncation=True, max_length=128).to(self.device)
                # Transformers 4.57.6 的 get_text_features 读取了未启用的 BERT pooler。
                # 按该版本 ChineseCLIPModel.forward 的实际实现，投影最后一层 CLS。
                text_output = self.visual_model.text_model(**inputs, return_dict=True)
                features = self.visual_model.text_projection(text_output.last_hidden_state[:, 0, :])
                vectors.append(features.cpu().numpy())
        text_vectors = normalize(np.concatenate(vectors))
        self.visual_anchor_vectors = text_vectors[:len(self.anchors)]
        self.song_text_vectors = text_vectors[len(self.anchors):]

    def image_features(self, image: Image.Image) -> dict[str, np.ndarray]:
        import torch

        self.ensure_vision()
        image = ImageOps.exif_transpose(image).convert("RGB")
        with torch.inference_mode():
            inputs = self.visual_processor(images=image, return_tensors="pt").to(self.device)
            vector = _feature_tensor(self.visual_model.get_image_features(**inputs)).cpu().numpy()[0]
        embedding = normalize(vector)
        anchor_scores = self.visual_anchor_vectors @ embedding
        return {"embedding": embedding, "profile": semantic_profile(anchor_scores), "anchor_scores": anchor_scores}

    def rank_features(self, features: dict[str, np.ndarray]) -> dict:
        if not self.index_loaded:
            self.load_index()
        self.ensure_vision()
        profile = np.asarray(features["profile"], dtype=np.float32)
        embedding = np.asarray(features["embedding"], dtype=np.float32)
        if profile.shape != (len(self.anchors),) or embedding.shape != (self.song_text_vectors.shape[1],):
            raise ValueError("图像特征维度与当前语义模型不一致")
        if not np.isfinite(profile).all() or not np.isfinite(embedding).all():
            raise ValueError("图像特征包含无效数值")
        audio_scores = self.audio_profiles @ profile
        metadata_scores = self.song_text_vectors @ embedding
        metadata_scores = np.clip((metadata_scores - metadata_scores.mean()) / max(float(metadata_scores.std()) * 3, 1e-6), -1, 1)
        scores = .65 * audio_scores + .35 * metadata_scores[self.song_indices]
        ranked = []
        for song_index, song in enumerate(self.library):
            candidates = np.flatnonzero(self.song_indices == song_index)
            winner = int(candidates[np.argmax(scores[candidates])])
            segment_index = int(self.segment_indices[winner])
            segment = song["segments"][segment_index]
            ranked.append({"songIndex": song_index, "segIndex": segment_index,
                           "file": song["file"],
                           "score": float(scores[winner]), "energy": float(segment[3]),
                           "audioScore": float(audio_scores[winner]),
                           "metadataScore": float(metadata_scores[song_index]),
                           "start": float(segment[1]), "end": float(segment[2])})
        ranked.sort(key=lambda row: (-row["score"], row["songIndex"]))
        concept_scores = np.asarray(features.get("anchor_scores", profile))
        concepts = [{"label": self.anchors[int(i)]["label"], "score": float(concept_scores[i])}
                    for i in np.argsort(-concept_scores, kind="stable")[:5]]
        return {"ranked": ranked, "concepts": concepts, "method": "semantic",
                "model_names": {"visual": VISUAL_MODEL, "audio": AUDIO_MODEL},
                "device": self.device, "score_kind": "relative_similarity_not_probability",
                "weights": {"audio_semantic": .65, "human_metadata": .35, "color": 0.0}}

    def match(self, image: Image.Image) -> dict:
        if not self.index_loaded:
            self.load_index()
        return self.rank_features(self.image_features(image))


def decode_window(file: Path, start: float, duration: float) -> np.ndarray:
    result = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.6f}", "-i", str(file),
                             "-t", f"{duration:.6f}", "-ac", "1", "-ar", str(SAMPLE_RATE),
                             "-f", "f32le", "pipe:1"], capture_output=True, timeout=120)
    if result.returncode or len(result.stdout) < 4:
        raise RuntimeError(f"音频窗口解码失败：{file.name} @ {start}: {result.stderr.decode(errors='replace')[:500]}")
    audio = np.frombuffer(result.stdout, dtype="<f4").copy()[:int(SAMPLE_RATE * WINDOW_SECONDS)]
    if not np.isfinite(audio).all():
        raise ValueError(f"音频含无效数值：{file}")
    return audio


def build_audio_index(root: Path | str = ROOT, device: str = "auto", force: bool = False,
                      progress: Callable[[str], None] = print) -> dict:
    import torch
    from transformers import ClapModel, ClapProcessor

    root = Path(root).resolve()
    matcher = SemanticMatcher(root, device)
    fingerprint, identity = _identity(root, matcher.library, matcher.anchors_bytes, matcher.library_bytes)
    if not force and matcher.index_path.exists() and matcher.meta_path.exists():
        try:
            matcher.load_index()
            progress("语义索引与当前文件一致，直接使用缓存。")
            return matcher.index_meta
        except ValueError:
            pass
    started = time.monotonic()
    actual_device = choose_device(device)
    progress(f"加载本地 CLAP，设备：{actual_device}")
    model_path = root / "model/clap-htsat-unfused"
    processor = ClapProcessor.from_pretrained(model_path, local_files_only=True)
    model = ClapModel.from_pretrained(model_path, local_files_only=True).eval().to(actual_device)
    torch.manual_seed(0)
    np.random.seed(0)
    with torch.inference_mode():
        text_inputs = processor(text=[a["music"] for a in matcher.anchors], return_tensors="pt", padding=True, truncation=True).to(actual_device)
        text_vectors = normalize(_feature_tensor(model.get_text_features(**text_inputs)).cpu().numpy())
    cache_dir = root / "data/semantic_cache" / fingerprint
    cache_dir.mkdir(parents=True, exist_ok=True)
    all_vectors, song_indices, segment_indices = [], [], []
    for i, song in enumerate(matcher.library):
        cached = cache_dir / f"song-{i:03d}.npz"
        vectors = None
        if cached.exists() and not force:
            with np.load(cached, allow_pickle=False) as data:
                candidate = data["embeddings"]
                if candidate.shape == (len(song["segments"]), text_vectors.shape[1]) and np.isfinite(candidate).all():
                    vectors = candidate
        if vectors is None:
            rows = []
            for k, segment in enumerate(song["segments"]):
                start, end = float(segment[1]), float(segment[2])
                windows = [decode_window(root / song["file"], t, min(WINDOW_SECONDS, end - t))
                           for t in window_starts(start, end)]
                with torch.inference_mode():
                    inputs = processor(audios=windows, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding="repeatpad", truncation="rand_trunc").to(actual_device)
                    vectors_for_window = normalize(_feature_tensor(model.get_audio_features(**inputs)).cpu().numpy())
                rows.append(normalize(vectors_for_window.mean(axis=0)))
                progress(f"[{i+1}/{len(matcher.library)}] {song['title']} 段落 {k+1}/{len(song['segments'])} 完成")
            vectors = np.stack(rows)
            _atomic_npz(cached, embeddings=vectors)
        else:
            progress(f"[{i+1}/{len(matcher.library)}] {song['title']} 使用缓存")
        all_vectors.append(vectors)
        song_indices.extend([i] * len(song["segments"]))
        segment_indices.extend(range(len(song["segments"])))
    audio_vectors = normalize(np.concatenate(all_vectors))
    audio_profiles = semantic_profile(audio_vectors @ text_vectors.T)
    _atomic_npz(matcher.index_path, audio_profiles=audio_profiles, audio_embeddings=audio_vectors,
                anchor_embeddings=text_vectors, song_indices=np.asarray(song_indices, dtype=np.int64),
                segment_indices=np.asarray(segment_indices, dtype=np.int64))
    meta = {"ready": True, "fingerprint": fingerprint, "identity": identity,
            "model_names": {"visual": VISUAL_MODEL, "audio": AUDIO_MODEL},
            "songs": len(matcher.library), "segments": len(song_indices), "concepts": len(matcher.anchors),
            "device": actual_device, "elapsed_seconds": round(time.monotonic() - started, 3),
            "torch_version": torch.__version__,
            "notes": "固定段内窗口；边界沿用原有启发式切段。模型权重已实际加载，未进行上游内容哈希比对。"}
    _atomic_json(matcher.meta_path, meta)
    matcher.load_index()
    progress(f"已写入 {matcher.index_path}，共 {len(song_indices)} 个段落。")
    return meta
