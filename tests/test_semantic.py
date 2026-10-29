"""无需大模型推理的关键不变量测试。"""
import unittest
from pathlib import Path
import sys
import json
import shutil
import uuid

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.semantic import SemanticMatcher, semantic_profile, window_starts, _identity


class SemanticTests(unittest.TestCase):
    def test_windows_stay_inside_segment_and_are_repeatable(self):
        self.assertEqual(window_starts(20, 55), [20.0, 45.0])
        self.assertEqual(window_starts(20, 25), [20.0])
        self.assertEqual(window_starts(20, 30), [20.0])
        self.assertEqual(window_starts(20, 55), window_starts(20, 55))
        with self.assertRaises(ValueError):
            window_starts(10, 10)

    def test_constant_profile_is_finite_and_uninformative(self):
        np.testing.assert_array_equal(semantic_profile(np.ones(40)), np.zeros(40))

    def test_profile_ignores_uniform_similarity_offset(self):
        np.testing.assert_allclose(semantic_profile([.1, .3, .2]), semantic_profile([.6, .8, .7]), atol=1e-6)

    def test_ranking_returns_best_segment_for_each_song_without_repetition(self):
        matcher = object.__new__(SemanticMatcher)
        matcher.index_loaded = True
        matcher.ensure_vision = lambda: None
        matcher.device = "cpu"
        matcher.library = [{"file": "a.mp3", "segments": [["a", 0, 10, .4], ["b", 10, 20, .6]]},
                           {"file": "b.mp3", "segments": [["c", 0, 15, .5]]}]
        matcher.anchors = [{"label": "平静"}, {"label": "热烈"}]
        matcher.audio_profiles = np.array([[-1, 0], [1, 0], [.2, .8]], dtype=np.float32)
        matcher.song_indices = np.array([0, 0, 1])
        matcher.segment_indices = np.array([0, 1, 0])
        matcher.song_text_vectors = np.array([[1, 0], [1, 0]], dtype=np.float32)
        result = matcher.rank_features({"profile": np.array([1, 0]), "embedding": np.array([1, 0])})
        self.assertEqual([(r["songIndex"], r["segIndex"]) for r in result["ranked"]], [(0, 1), (1, 0)])
        self.assertGreater(result["ranked"][0]["score"], result["ranked"][1]["score"])
        self.assertEqual(result["ranked"][0]["start"], 10)
        self.assertEqual(result["ranked"][0]["file"], "a.mp3")


class IndexValidationTests(unittest.TestCase):
    def setUp(self):
        self.test_root = Path(__file__).resolve().parents[1] / "work" / "semantic-tests"
        self.root = self.test_root / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        self.addCleanup(self.cleanup_test_directory)
        for folder in ["data", "server", "model/chinese-clip-vit-base-patch16", "model/clap-htsat-unfused"]:
            (self.root / folder).mkdir(parents=True)
        # 测试占位：只测试索引有效性校验，不把这些字节当作模型或音频加载。
        for name in ["chinese-clip-vit-base-patch16", "clap-htsat-unfused"]:
            (self.root / "model" / name / "pytorch_model.bin").write_bytes(b"test-placeholder")
            (self.root / "model" / name / "config.json").write_text("{}", encoding="utf-8")
        (self.root / "test.mp3").write_bytes(b"test-placeholder")
        self.library = [{"file": "test.mp3", "segments": [["a", 0, 10, .4], ["b", 10, 20, .6]]}]
        (self.root / "data/demo_library.json").write_text(json.dumps(self.library), encoding="utf-8")
        (self.root / "server/anchors.json").write_text(json.dumps({"concepts": [{"label": "a"}, {"label": "b"}]}), encoding="utf-8")
        self.matcher = SemanticMatcher(self.root, "cpu")
        fingerprint, _ = _identity(self.root, self.library, self.matcher.anchors_bytes, self.matcher.library_bytes)
        self.matcher.meta_path.write_text(json.dumps({"ready": True, "fingerprint": fingerprint}), encoding="utf-8")
        self.write_index()

    def cleanup_test_directory(self):
        if self.root.resolve().is_relative_to(self.test_root.resolve()):
            shutil.rmtree(self.root)

    def write_index(self, segments=None):
        np.savez(self.matcher.index_path, audio_profiles=np.array([[1, -1], [-1, 1]], dtype=np.float32),
                 song_indices=np.array([0, 0]), segment_indices=np.array([0, 1] if segments is None else segments))

    def test_valid_index_loads(self):
        self.matcher.load_index()
        self.assertTrue(self.matcher.index_loaded)

    def test_changed_library_is_rejected(self):
        self.library[0]["segments"][0][2] = 9
        (self.root / "data/demo_library.json").write_text(json.dumps(self.library), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "已过期"):
            SemanticMatcher(self.root, "cpu").load_index()

    def test_changed_anchor_snapshot_is_rejected(self):
        self.matcher.load_index()
        (self.root / "server/anchors.json").write_text('{"concepts": []}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "已改变"):
            self.matcher.load_index()
        self.assertFalse(self.matcher.index_loaded)

    def test_out_of_order_segments_are_rejected_and_disable_loaded_index(self):
        self.matcher.load_index()
        self.write_index([1, 0])
        with self.assertRaisesRegex(ValueError, "顺序不匹配"):
            self.matcher.load_index()
        self.assertFalse(self.matcher.index_loaded)

    def test_fractional_segment_indices_are_rejected(self):
        self.write_index([0.5, 1.5])
        with self.assertRaisesRegex(ValueError, "编号格式无效"):
            self.matcher.load_index()


if __name__ == "__main__":
    unittest.main()
