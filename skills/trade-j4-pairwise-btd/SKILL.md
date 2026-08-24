---
name: "trade-j4-pairwise-btd"
description: "比较同任务候选结果并用含平局的 Bradley–Terry–Davidson 模型排序。用户要求 Pairwise GSB、偏序、分组或归一化评分时触发。"
version: "1.1.0"
---

# J4 Pairwise + Davidson BTD

## 唯一职责
对同一任务候选作 `A`、`B` 或 `Same` 判断，再用 Davidson 平局扩展聚合；不修改 J1—J3，不引入统一 envelope。

## 可执行协议
- 每条必须显式给 `critical_gate.result` 及双方 critical refs。单侧核心 critical 方禁止获胜。
- 用 `judgement_refs` 追溯 J1—J3，用 `root_issue_keys` 合并同一底层问题；J1/J2 重复诊断只算一个维度。
- 非 Same 的 `evidence.a_refs`、`evidence.b_refs` 都必须非空且可定位。
- Same 必须细分 `equivalent`、`incomparable` 或 `insufficient_evidence`。
- 同一 `task_id + unordered pair` 仅一个 primary；同向重复去重，反向 primary 副本拒绝。
- `swap_check` 仅校验标签对称，引用 `swap_of`，不计 BTD 票。
- `confidence` 为 0.05..1、`weight` 为 0.1..5；iterations、learning_rate、group_threshold 亦受 schema 和运行时双重约束。

## BTD 与状态
沿用 Davidson：`P(i胜)=πi/(πi+πj+ν√(πiπj))`，平局分子为 `ν√(πiπj)`。输出 submitted/accepted/deduplicated/swap/rejected/btd vote counts，并显式报告 `ranked`、`all_same`、`disconnected` 或 `insufficient_comparisons`。

## 执行
语义 Judger 读取 `expert-rules.md` 与 `expert-cases.jsonl`，按 `prompt.md` 生成输入，执行 `node index.js input.json ranking.json`。输出符合 `schema.json#/$defs/output`。
