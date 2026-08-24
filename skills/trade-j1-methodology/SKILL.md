---
name: "trade-j1-methodology"
description: "评测外贸数据任务的方法路线是否支持用户业务判断。用户要求检查问题定义、来源策略、缺失降级、推荐排序、企业分析或关键验证时触发。"
version: "1.1.0"
---

# J1 方法论 Judger

## 唯一职责
判断被测模型解决外贸数据问题的方法路线是否合理，是否足以支持用户业务判断。不得判断具体币种、公式、数值或抄录是否正确（J2）、任务是否完整（J3）或模型排名（J4）。

## 输入
读取 `schema.json#/$defs/input`。语义 Judger 从 task、trace、artifacts 与 final_report 抽取固定六维，每维必须且只能出现一次：`problem_definition`、`source_strategy`、`missing_data`、`transformation`、`calculation`、`validation`。

每个维度必须包含状态、严重度、置信度、理由、证据引用和证据原文。输入不得包含 `weight`；权重固定在 `index.js`。

## 工作流
1. 读取 `expert-rules.md` 和 `expert-cases.jsonl`。
2. 按 `prompt.md` 先定位证据，再将每条原子问题归入唯一主维度并去重。
3. `pass/partial/fail` 必须提供非空 `evidence_refs` 和 `quoted_evidence`。
4. 适用但不可观察时用 `insufficient_evidence/info`；客观无需执行时用 `not_applicable/info`，不得互相替代。
5. 执行 `node index.js input.json output.json`，输出符合 `schema.json#/$defs/output`。

## 判定与计分
- 合法组合：`pass/info`；`partial/minor|major`；`fail/minor|major|critical`；`not_applicable/info`；`insufficient_evidence/info`。
- `pass=1`、`partial=0.5`、`fail=0`；六维权重由执行器固定为 1。
- `methodology_quality_score` 仅在可判定维度上计算；顶层 `score` 与其相同，保持兼容。
- `evidence_coverage` 是可判定维度权重 /（可判定 + 证据不足维度权重）；`conservative_score` 将 `insufficient_evidence` 按 0 纳入分母。
- `not_applicable` 不进入上述分母；`fail/critical` 触发 `critical_failure=true`。

## 专家如何修改
新增或修正规则时保持 `expert-rules.md` 模板，并在 `expert-cases.jsonl` 补充维度、生成与去重校准字段。只有固定维度、执行器权重或输出字段变化时才修改脚本或 Schema。

## 输出
只接受 JSON。不得用篇幅、引用数量或工具调用数量作为独立加分项。
