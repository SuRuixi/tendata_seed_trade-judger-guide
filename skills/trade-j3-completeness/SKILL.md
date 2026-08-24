---
name: "trade-j3-completeness"
description: "检查外贸分析报告是否完整满足任务和交付约束。用户要求拆任务契约、查必选项缺失或条件要求覆盖时触发。"
version: "1.0.0"
---

# J3 完整性 Judger

## 职责

核验最终交付是否包含任务所需内容、必要闭环和触发披露。不评价方法合理性（J1）、数据/来源/计算真实性（J2）、版式美观或固定章节。

## 建模与去重

1. 读取 `expert-rules.md` 与 `expert-cases.jsonl`；案例同时校准 requirement 是否应生成及生成后的 kind/status。
2. 先从用户、系统、正式合同和明确交付要求建立语义槽位。任务上下文负责定义 requirement，并可用于解析最终交付的对象/口径：唯一上下文无需逐字复述，但最终交付必须实际给出请求的结果/结论。多对象、多口径、独立附件或可能错配时要求明确标识。
3. 按用户主要交付目标选择一个主体任务规则。其他匹配规则只补主规则未覆盖且确实被明示或任务形态触发的槽位；同一语义槽位只能生成一个计分 requirement。
4. 结构规则原则上引用/校验已有任务槽位，不复制对象、范围、时间、结果或结论。仅载体自包含、正文—附件闭合等真正独立且未表达的结构语义可新增一次。
5. 能独立缺失的槽位分别建立 requirement；可替代满足项写入同一语义槽位，例如“职位或部门标识”。指标与单位、推荐对象与依据、包含与排除等独立槽位分别建立。

## Conditional 证据域

- `trigger_evidence_refs`：可引用 trace、artifact、source 或 final，只用于证明条件已触发。
- `evidence_refs`：只引用最终交付，只用于判断披露是否 covered/partial/missing/insufficient_evidence。
- 条件触发后，方法、范围、限制、影响等能独立缺失的披露分别建模；未触发时 `triggered: false`、`status: not_triggered`。

## 状态与证据

状态仅使用 `covered`、`partial`、`missing`、`not_triggered`、`insufficient_evidence`。`partial` 只用于一个原子槽位已有内容但自身不完整。trace 不能补最终覆盖；正式交付物不可读为 `insufficient_evidence`，该状态不等于确认内容缺失，但完整度按未能验收计 0。

## 聚合

- required：计入 required coverage 与 overall score；
- 已触发 conditional：计入 conditional coverage 与 overall score；
- optional：仅诊断记录，完全不进入 overall score，不加分也不扣分；
- `covered=1`、`partial=0.5`、`missing=0`、`insufficient_evidence=0`；未触发 conditional 不计分。

执行 `node index.js input.json output.json`。