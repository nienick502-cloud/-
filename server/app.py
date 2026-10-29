"""身临其境本地服务：只在本机运行，照片仅用于当前请求的语义推理。"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parents[1]
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 30_000_000
LOG = logging.getLogger("immersion")


def decode_image(payload: bytes) -> Image.Image:
    """识别实际文件内容，限制解码体积并应用照片方向信息。"""
    if not payload:
        raise HTTPException(400, "照片文件为空。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as source:
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, "照片超过 3000 万像素，请缩小后重试。")
                source.load()
                return ImageOps.exif_transpose(source).convert("RGB")
    except HTTPException:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise HTTPException(413, "照片像素过大，请缩小后重试。") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(400, "无法读取这张照片，请使用 JPEG、PNG 或 WebP 图片。") from exc


class LocalMatcher:
    """模型初始化与推理共用一把锁，避免同时加载模型或争用显存。"""

    def __init__(self, root: Path, factory=None):
        self.root = root
        self.factory = factory
        self.matcher = None
        self.error = ""
        self.last_attempt = 0.0
        self.lock = threading.Lock()

    def _initialize(self):
        if self.matcher is not None:
            return self.matcher
        if self.error and time.monotonic() - self.last_attempt < 5:
            raise RuntimeError(self.error)
        self.last_attempt = time.monotonic()
        try:
            if self.factory is None:
                from server.semantic import SemanticMatcher

                factory = SemanticMatcher
            else:
                factory = self.factory
            matcher = factory(root=self.root, device=os.environ.get("IMMERSION_DEVICE", "auto"))
            matcher.load_index()
            self.matcher = matcher
            self.error = ""
            return matcher
        except Exception as exc:
            self.error = str(exc)
            LOG.warning("语义服务初始化失败：%s", exc)
            raise

    def initialize(self):
        with self.lock:
            return self._initialize()

    def match(self, image: Image.Image):
        with self.lock:
            try:
                result = self._initialize().match(image)
                self.error = ""
                return result
            except Exception as exc:
                self.error = str(exc)
                # 推理初始化可能只完成了一部分，失败后重建，避免复用半加载对象。
                self.matcher = None
                self.last_attempt = time.monotonic()
                raise


def create_app(root: Path = ROOT, matcher_factory=None) -> FastAPI:
    root = Path(root).resolve()
    service = LocalMatcher(root, matcher_factory)

    @asynccontextmanager
    async def lifespan(application):
        # 初始化失败仍提供网页和明确的健康状态；页面会显示色彩规则降级。
        try:
            await run_in_threadpool(service.initialize)
        except Exception:
            pass
        yield

    application = FastAPI(title="身临其境 · 本地语义匹配", lifespan=lifespan)
    application.state.matcher_service = service
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["null", "http://127.0.0.1:8765", "http://localhost:8765"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )

    @application.middleware("http")
    async def limit_upload(request, call_next):
        if request.url.path == "/api/match":
            length = request.headers.get("content-length")
            if length:
                try:
                    oversized = int(length) > MAX_UPLOAD_BYTES + 64 * 1024
                except ValueError:
                    return JSONResponse({"detail": "无效的请求长度。"}, status_code=400)
                if oversized:
                    return JSONResponse({"detail": "照片超过 20 MB，请压缩后重试。"}, status_code=413)
        return await call_next(request)

    @application.get("/api/health")
    def health():
        detail = ("本地视觉模型和段落索引已就绪"
                  if getattr(service.matcher, "visual_model", None) is not None
                  else "段落索引已就绪，视觉模型在首次匹配时加载")
        return {
            "ready": service.matcher is not None and not service.error,
            "method": "semantic" if service.matcher is not None and not service.error else "unavailable",
            "device": str(getattr(service.matcher, "device", "尚未加载")),
            "detail": service.error or detail,
        }

    @application.post("/api/match")
    async def match(file: UploadFile = File(...)):
        try:
            payload = await file.read(MAX_UPLOAD_BYTES + 1)
        finally:
            await file.close()
        if len(payload) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "照片超过 20 MB，请压缩后重试。")
        image = await run_in_threadpool(decode_image, payload)
        try:
            return await run_in_threadpool(service.match, image)
        except Exception as exc:
            LOG.exception("本地语义推理失败")
            raise HTTPException(503, "本地语义匹配暂不可用：" + str(exc)) from exc
        finally:
            image.close()

    @application.get("/")
    def page():
        return FileResponse(root / "index.html")

    # 只开放产品资源；模型、代码、环境和 .git 不通过 HTTP 暴露。
    for name in ("demo list", "picture", "outputs"):
        application.mount("/" + name, StaticFiles(directory=root / name, check_dir=False), name=name)
    return application


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
