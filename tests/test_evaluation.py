"""验证统计口径、基线执行和报告内联数据边界，无需模型权重。"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("evaluate_semantic", ROOT / "pipeline/evaluate_semantic.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class EvaluationTests(unittest.TestCase):
    def test_distribution_keeps_zero_coverage_and_denominator(self):
        library = [{"title": "橘子花火", "artist": "a"}, {"title": "b", "artist": "b"}, {"title": "c", "artist": "c"}]
        rows = [{"color": {"warm": .9}, "semantic": [{"songIndex": 0}, {"songIndex": 1}]},
                {"color": {"warm": .2}, "semantic": [{"songIndex": 0}, {"songIndex": 1}]}]
        result = evaluation.distribution(rows, "semantic", library)
        self.assertEqual(result["top1_unique"], 1)
        self.assertEqual(result["top3_unique"], 2)
        self.assertEqual(result["counts"][2]["top1"], 0)
        self.assertEqual(result["max_song_share"], 1)
        self.assertEqual(result["effective_songs"], 1)
        self.assertEqual(result["warm_orange_top1"], 1)
        self.assertEqual(result["warm_images"], 1)

    def test_script_json_cannot_close_script(self):
        value = {"title": '</script><script>alert("x")</script>', "line": "\u2028"}
        encoded = evaluation.safe_script_json(value)
        self.assertNotIn("<", encoded)
        self.assertEqual(json.loads(encoded), value)

    def test_actual_browser_baseline_returns_all_songs(self):
        ranks = evaluation.baseline_rankings([{"warm": 1, "lum": .52, "sat": .5, "contrast": .2}])[0]
        library = json.loads((ROOT / "data/demo_library.json").read_text(encoding="utf-8"))
        self.assertEqual(len(ranks), len(library))
        self.assertEqual(len({r["songIndex"] for r in ranks}), len(library))
        self.assertEqual(library[ranks[0]["songIndex"]]["title"], "橘子花火")


if __name__ == "__main__":
    unittest.main()
