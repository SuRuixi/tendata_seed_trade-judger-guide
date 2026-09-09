import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


def valid_trial(index, outcome, orientation="AB", same_reason=None,
                a_blocked=False, b_blocked=False):
    layers = {
        layer: {
            "applicable": layer != "j5",
            "outcome": outcome if layer != "j5" else "S",
            "confidence": 0.9,
            "a_evidence": ["A evidence"] if layer != "j5" else [],
            "b_evidence": ["B evidence"] if layer != "j5" else [],
            "reason": "test",
        }
        for layer in main.GSB_LAYER_KEYS
    }
    return {
        "trial_id": f"trial-{index}",
        "pair_index": (index + 1) // 2,
        "orientation": orientation,
        "status": "valid",
        "displayed_outcome": outcome if orientation == "AB" else main._mirror_gsb_outcome(outcome),
        "displayed_declared_outcome": outcome if orientation == "AB" else main._mirror_gsb_outcome(outcome),
        "canonical_outcome": outcome,
        "canonical_declared_outcome": outcome,
        "outcome_overridden": False,
        "score_margin": 1 if outcome == "G" else -1 if outcome == "B" else 0,
        "same_reason": same_reason,
        "confidence": 0.9,
        "critical_gate": {"a_blocked": a_blocked, "b_blocked": b_blocked},
        "canonical_critical_gate": {"a_blocked": a_blocked, "b_blocked": b_blocked},
        "decisive_dimensions": ["fidelity"],
        "a_evidence": ["A evidence"],
        "b_evidence": ["B evidence"],
        "canonical_a_evidence": ["A evidence"],
        "canonical_b_evidence": ["B evidence"],
        "layer_judgements": layers,
        "canonical_layer_judgements": layers,
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
            "declared_outcome": "G",
            "same_reason": None,
            "confidence": 0.8,
            "critical_gate": {"a_blocked": False, "b_blocked": True},
            "decisive_dimensions": ["fidelity"],
            "a_evidence": ["displayed A"],
            "b_evidence": ["displayed B"],
            "reason": "displayed A wins",
            "layer_judgements": {
                layer: {
                    "applicable": layer != "j5",
                    "outcome": "G" if layer != "j5" else "S",
                    "confidence": 0.8,
                    "a_evidence": ["displayed A"] if layer != "j5" else [],
                    "b_evidence": ["displayed B"] if layer != "j5" else [],
                    "reason": "test",
                }
                for layer in main.GSB_LAYER_KEYS
            },
        }
        row = main._canonicalize_gsb(payload, "BA")
        self.assertEqual(row["canonical_outcome"], "B")
        self.assertTrue(row["canonical_critical_gate"]["a_blocked"])
        self.assertEqual(row["canonical_a_evidence"], ["displayed B"])
        self.assertEqual(row["canonical_layer_judgements"]["j2"]["outcome"], "B")
        self.assertEqual(row["canonical_layer_judgements"]["j2"]["a_evidence"], ["displayed B"])

    def test_critical_gate_overrides_declared_winner(self):
        raw = json.dumps({
            "declared_outcome": "G",
            "same_reason": None,
            "confidence": 0.8,
            "critical_gate": {"a_blocked": True, "b_blocked": False},
            "layer_judgements": {
                layer: {
                    "applicable": layer != "j5",
                    "outcome": "G" if layer != "j5" else "S",
                    "confidence": 0.8,
                    "a_evidence": ["a"] if layer != "j5" else [],
                    "b_evidence": ["b"] if layer != "j5" else [],
                    "reason": "test",
                }
                for layer in main.GSB_LAYER_KEYS
            },
            "reason": "invalid winner",
        })
        result = main._parse_gsb_judgement(raw, trace_available=False)
        self.assertEqual(result["outcome"], "B")
        self.assertTrue(result["outcome_overridden"])
        self.assertEqual(result["score_margin"], -1)

    def test_weighted_layers_exclude_inapplicable_j5(self):
        layers = {
            "j1": {"applicable": True, "outcome": "G", "confidence": 1},
            "j2": {"applicable": True, "outcome": "G", "confidence": 1},
            "j3": {"applicable": True, "outcome": "B", "confidence": 1},
            "j5": {"applicable": False, "outcome": "S", "confidence": 1},
        }
        outcome, margin = main._compute_gsb_outcome(
            layers, {"a_blocked": False, "b_blocked": False}
        )
        self.assertEqual(outcome, "G")
        self.assertAlmostEqual(margin, 0.294118, places=6)

    def test_j5_must_be_inapplicable_without_trace(self):
        layer = {
            "applicable": True,
            "outcome": "G",
            "confidence": 0.8,
            "a_evidence": ["trace:a"],
            "b_evidence": ["trace:b"],
            "reason": "trace comparison",
        }
        with self.assertRaises(ValueError):
            main._validate_gsb_layer("j5", layer, trace_available=False)
        validated = main._validate_gsb_layer("j5", layer, trace_available=True)
        self.assertTrue(validated["applicable"])

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

    def test_unstable_j2_blocks_otherwise_solid_result(self):
        trials = [
            valid_trial(i, "G", "AB" if i % 2 else "BA")
            for i in range(1, 9)
        ]
        for i, trial in enumerate(trials):
            trial["canonical_layer_judgements"]["j2"]["outcome"] = "G" if i < 4 else "B"
        result = self.aggregate(trials)
        self.assertFalse(result["solid"])
        self.assertIn("J2 层级一致率低于 80% 或存在并列众数", result["solid_reasons"])

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
