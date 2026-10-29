"""只验证 HTTP 边界与失败行为；模型效果由真实图片对照实验验证。"""

import io
import shutil
import unittest
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from server.app import MAX_UPLOAD_BYTES, create_app


class FakeMatcher:
    def __init__(self, root, device):
        self.device = "cpu"
        self.visual_model = None

    def load_index(self):
        pass

    def match(self, image):
        assert image.mode == "RGB"
        assert image.size == (12, 8)
        self.visual_model = object()
        return {
            "method": "semantic",
            "ranked": [{"songIndex": 0, "segIndex": 1, "score": 0.2, "energy": 0.4}],
            "concepts": [{"label": "测试意境", "score": 0.3}],
        }


class UnavailableMatcher(FakeMatcher):
    def load_index(self):
        raise FileNotFoundError("测试：段落索引不存在")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.test_root = Path(__file__).resolve().parents[1] / "work" / "api-tests"
        self.root = self.test_root / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        (self.root / "index.html").write_text("测试页面", encoding="utf-8")
        (self.root / "picture").mkdir()
        (self.root / "model").mkdir()
        (self.root / "model" / "secret.bin").write_bytes(b"not-public")
        self.client = TestClient(create_app(self.root, FakeMatcher))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        if self.root.resolve().is_relative_to(self.test_root.resolve()):
            shutil.rmtree(self.root)

    def photo(self):
        stream = io.BytesIO()
        Image.new("RGBA", (12, 8), (255, 100, 40, 255)).save(stream, "PNG")
        return {"file": ("photo.png", stream.getvalue(), "image/png")}

    def test_upload_reaches_matcher_as_decoded_rgb(self):
        self.assertIn("首次匹配时加载", self.client.get("/api/health").json()["detail"])
        result = self.client.post("/api/match", files=self.photo())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["method"], "semantic")
        self.assertEqual(result.json()["ranked"][0]["segIndex"], 1)
        health = self.client.get("/api/health").json()
        self.assertTrue(health["ready"])
        self.assertEqual(health["detail"], "本地视觉模型和段落索引已就绪")

    def test_invalid_image_is_rejected_before_inference(self):
        result = self.client.post("/api/match", files={"file": ("fake.jpg", b"not an image", "image/jpeg")})
        self.assertEqual(result.status_code, 400)

    def test_oversized_request_is_rejected(self):
        result = self.client.post("/api/match", content=b"small", headers={"content-length": str(MAX_UPLOAD_BYTES + 65537)})
        self.assertEqual(result.status_code, 413)

    def test_only_product_assets_are_public(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/model/secret.bin").status_code, 404)
        self.assertEqual(self.client.get("/server/app.py").status_code, 404)
        self.assertEqual(self.client.get("/picture/%2e%2e/model/secret.bin").status_code, 404)

    def test_file_origin_can_reach_local_api(self):
        result = self.client.post("/api/match", files=self.photo(), headers={"Origin": "null"})
        self.assertEqual(result.headers.get("access-control-allow-origin"), "null")
        other = self.client.get("/api/health", headers={"Origin": "https://example.com"})
        self.assertNotIn("access-control-allow-origin", other.headers)

    def test_unavailable_model_is_not_reported_as_semantic_success(self):
        with TestClient(create_app(self.root, UnavailableMatcher)) as client:
            health = client.get("/api/health").json()
            self.assertFalse(health["ready"])
            self.assertEqual(health["method"], "unavailable")
            result = client.post("/api/match", files=self.photo())
            self.assertEqual(result.status_code, 503)
            self.assertIn("段落索引不存在", result.json()["detail"])


if __name__ == "__main__":
    unittest.main()
