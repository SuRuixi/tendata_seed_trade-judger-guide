---
name: "trade-j2-fidelity"
description: "核验外贸报告中的数据 Claim 和可核验事实 Claim 是否忠实于来源、查询条件和变换过程。用户要求查数据偏差、溯源链、主体匹配或核心数据错误时触发。"
version: "1.0.0"
---

# J2 数据忠实度 Judger

## 唯一职责

逐个核验最终报告中的数据 Claim 和可核验事实 Claim，建立 `claim -> transformation -> source` 链。核验范围包括数值、排名、占比、增速、趋势、比较关系，以及 HS Code、企业主体、联系人、贸易角色和查询口径等事实 Claim。

不得因方法看起来专业而忽略数据错误，也不得评价任务覆盖或模型排名。评测时以模型实际使用的数据为准；外部复核数据只能用于核验，不能替模型修正输入。

## 偏差分类

- `none`：来源、定义、时间、单位和计算一致；
- `transcription`：抄写错误；
- `definition`：贸易方向、主体、伙伴、商品口径、HS 或查询条件不一致；
- `time`：年份、月份、累计窗口或披露时点不一致；
- `unit_currency`：数量单位、币种、名义/实际值或 FOB/CIF 错误；
- `aggregation`：重复、漏项、缺失值处理或错误汇总；
- `calculation`：公式、分母、增长率或舍入错误；
- `source_quality`: source content was actually read and is locatable, but its type, granularity, scope, or context is inadequate for the Claim;
- `insufficient_evidence`: the source was not actually read, no concrete record can be located, or the evidence chain is incomplete.

## 工作流

1. 先读取 `expert-rules.md` 和 `expert-cases.jsonl`，应用专家确认的偏差规则。
2. 用 `prompt.md` 从报告抽取所有承重数据 Claim 和可核验事实 Claim。
3. 为每项记录报告值、事实内容、变换说明、来源值或来源记录、来源引用和证据。
4. 区分模型原始来源与 Judger 外部复核证据；网络、平台和官方来源冲突时先核验口径，无法裁定使用 `insufficient_evidence`。
5. 执行 `node index.js input.json output.json`。
6. 输出符合 `schema.json#/$defs/output`。

## 专家如何修改

新增统计口径、数据偏差或严重度判断时，优先编辑 `expert-rules.md`，并在 `expert-cases.jsonl` 增加成对案例。若要改变严重度权重或偏差率公式，再由工程同学修改 `index.js`。

## 聚合

严重度权重为 `info=0`、`minor=1`、`major=3`、`critical=8`。加权偏差率等于偏差 Claim 权重除以全部可核验 Claim 权重；`insufficient_evidence` 不进入分母；critical 偏差同时设置 `critical_failure=true`。

## 证据纪律

定义错误即使数值接近也不能判正确。无法定位来源时不得以常识补全。每个非 `none` 且非 `insufficient_evidence` 的判断必须含 evidence_refs；证据不足时应明确缺失的是 source、trace、artifact 还是 transformation。

## 输出

只接受 JSON。不得用篇幅、引用数量或工具调用数量作为独立加分项。

J1 owns source strategy and downgrade-method quality; J2 owns Claim fidelity to the source, proxy metric, and transformation actually used; J3 owns downgrade-disclosure coverage. J2 does not penalize missing disclosure again.
