import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


def valid_trial(index, outcome, orientation="AB", same_reason=None,
                a_blocked=False, b_blocked=False):
    return {
        "trial_id": f"trial-{index}",
        "pair_index": (index + 1) // 2,
        "orientation": orientation,
        "status": "valid",
        "displayed_outcome": outcome if orientation == "AB" else main._mirror_gsb_outcome(outcome),
        "canonical_outcome": outcome,
        "same_reason": same_reason,
        "confidence": 0.9,
        "critical_gate": {"a_blocked": a_blocked, "b_blocked": b_blocked},
        "canonical_critical_gate": {"a_blocked": a_blocked, "b_blocked": b_blocked},
        "decisive_dimensions": ["fidelity"],
        "a_evidence": ["A evidence"],
        "b_evidence": ["B evidence"],
        "canonical_a_evidence": ["A evidence"],
        "canonical_b_evidence": ["B evidence"],
        "reason": "test",
    }


class GSBTests(unittest.TestCase):
    def aggregate(self, trials, total=None, swap=True):
        return main.aggregate_gsb_trials(
            trials,
            total if total is not None else len(trials),
            swap,
            "model-a",
            "model-b",
            "query-1",
        )

    def test_query_fingerprint_normalizes_whitespace(self):
        self.assertEqual(main._query_fingerprint("a  b\nc"), main._query_fingerprint(" a b c "))

    def test_mirror_outcomes(self):
        self.assertEqual(main._mirror_gsb_outcome("G"), "B")
        self.assertEqual(main._mirror_gsb_outcome("B"), "G")
        self.assertEqual(main._mirror_gsb_outcome("S"), "S")

    def test_ba_trial_is_mapped_to_canonical_orientation(self):
        payload = {
            "outcome": "G",
            "same_reason": None,
            "confidence": 0.8,
            "critical_gate": {"a_blocked": False, "b_blocked": True},
            "decisive_dimensions": ["fidelity"],
            "a_evidence": ["displayed A"],
            "b_evidence": ["displayed B"],
            "reason": "displayed A wins",
        }
        row = main._canonicalize_gsb(payload, "BA")
        self.assertEqual(row["canonical_outcome"], "B")
        self.assertTrue(row["canonical_critical_gate"]["a_blocked"])
        self.assertEqual(row["canonical_a_evidence"], ["displayed B"])

    def test_parser_rejects_winner_blocked_by_critical_gate(self):
        raw = json.dumps({
            "outcome": "G",
            "same_reason": None,
            "confidence": 0.8,
            "critical_gate": {"a_blocked": True, "b_blocked": False},
            "decisive_dimensions": ["fidelity"],
            "a_evidence": ["a"],
            "b_evidence": ["b"],
            "reason": "invalid winner",
        })
        with self.assertRaises(ValueError):
            main._parse_gsb_judgement(raw)

    def test_solid_a_dominance(self):
        trials = [
            valid_trial(i, "G", "AB" if i % 2 else "BA")
            for i in range(1, 9)
        ]
        result = self.aggregate(trials)
        self.assertTrue(result["solid"])
        self.assertEqual(result["relation"], "A_dominates_B")
        self.assertEqual(result["metrics"]["swap_consistency"], 1.0)
        self.assertLess(result["metrics"]["sign_test_pvalue"], 0.05)

    def test_solid_same_requires_consistent_reason(self):
        trials = [
            valid_trial(i, "S", "AB" if i % 2 else "BA", "equivalent")
            for i in range(1, 9)
        ]
        result = self.aggregate(trials)
        self.assertTrue(result["solid"])
        self.assertEqual(result["relation"], "equivalent")
        self.assertEqual(result["metrics"]["same_reason_agreement"], 1.0)

    def test_oscillation_is_inconclusive(self):
        trials = [
            valid_trial(i, "G" if i <= 4 else "B", "AB" if i % 2 else "BA")
            for i in range(1, 9)
        ]
        result = self.aggregate(trials)
        self.assertFalse(result["solid"])
        self.assertEqual(result["relation"], "inconclusive")
        self.assertIn("众数一致率低于 80% 或存在并列众数", result["solid_reasons"])
        projection = result["j4_projection"]["input"]["comparisons"][0]
        self.assertEqual(projection["outcome"], "Same")
        self.assertEqual(projection["same_reason"], "insufficient_evidence")
        self.assertFalse(result["j4_projection"]["authoritative"])

    def test_invalid_trials_do_not_enter_counts(self):
        trials = [valid_trial(i, "G", "AB") for i in range(1, 7)]
        trials.extend([
            {"trial_id": "trial-7", "pair_index": 7, "orientation": "AB",
             "status": "invalid", "error": "timeout"},
            {"trial_id": "trial-8", "pair_index": 8, "orientation": "AB",
             "status": "invalid", "error": "invalid JSON"},
        ])
        result = self.aggregate(trials, total=10, swap=False)
        self.assertEqual(result["metrics"]["counts"], {"G": 6, "S": 0, "B": 0})
        self.assertEqual(result["metrics"]["invalid"], 4)
        self.assertFalse(result["solid"])

    def test_conflicting_critical_gates_are_not_solid(self):
        trials = [valid_trial(i, "S", same_reason="incomparable") for i in range(1, 9)]
        trials[0]["canonical_critical_gate"] = {"a_blocked": True, "b_blocked": False}
        trials[1]["canonical_critical_gate"] = {"a_blocked": False, "b_blocked": True}
        result = self.aggregate(trials, swap=False)
        self.assertFalse(result["solid"])
        self.assertTrue(result["metrics"]["critical_conflict"])

    def test_trial_failure_stays_invalid(self):
        request = main.GSBRequest(
            query_id="q1",
            query="question",
            candidate_a={"model_id": "a", "answer": "answer a"},
            candidate_b={"model_id": "b", "answer": "answer b"},
            repeats=2,
            swap_check=True,
            config={"model_id": "judge", "api_key": "test"},
        )
        with patch.object(main, "call_llm", return_value="not-json"):
            trial = main._run_gsb_trial(request, 0)
        self.assertEqual(trial["status"], "invalid")
        self.assertNotIn("canonical_outcome", trial)

    def test_j4_projection_is_valid_and_request_is_redacted(self):
        request = main.GSBRequest(
            query_id="q1",
            query="question",
            candidate_a={"model_id": "a", "answer": "answer a"},
            candidate_b={"model_id": "b", "answer": "answer b"},
            repeats=8,
            swap_check=True,
            config={"model_id": "judge", "api_key": "secret"},
        )
        trials = [
            valid_trial(i, "G", "AB" if i % 2 else "BA")
            for i in range(1, 9)
        ]
        with tempfile.TemporaryDirectory(dir=main.ROOT) as temp_dir:
            result = main._finalize_gsb(request, trials, Path(temp_dir))
            saved_request = json.loads((Path(temp_dir) / "request.json").read_text())
        self.assertTrue(result["solid"])
        self.assertEqual(result["relation"], "A_dominates_B")
        self.assertEqual(result["j4_projection"]["output"]["status"], "insufficient_comparisons")
        self.assertNotIn("api_key", saved_request)


if __name__ == "__main__":
    unittest.main()
