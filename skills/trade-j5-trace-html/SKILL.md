---
name: "trade-j5-trace-html"
description: "完整承接 J1—J4 actionable judgements，闭环映射、Trace 归因并生成自包含 HTML。"
version: "2.0.0"
---
# J5 Trace 诊断与 HTML 报告

## 唯一职责
读取当前版本 J1—J4 完整结果，建立 judgement registry 和 mapping ledger，回查 trace 并生成同源 JSON/HTML。不得修改上游结论，也不得把空对象、截断结果或旧版摘要当作无问题输入。

## 工作流
1. 读取 `expert-rules.md` 与案例。
2. 先校验版本结构与枚举：J1 固定六维 ID 全集、J2 claims 必要字段、J3 task_contract 条件结构及各自现行 status/severity/kind/deviation；拒绝 legacy ID 和陈旧状态。J4 标准 ranking 输出可直接传入，缺省 `conflicts` 归一为空数组。
3. 枚举 J1 partial/fail/insufficient、J2 非 none、J3 partial/missing/insufficient、J4 rejected/conflict。
4. 用 stable issue key 合并跨 Judger 同一问题，保留所有判断和证据引用；不同 finding 可共享 root cause id。
5. 每个 actionable judgement 所属 issue 必须在 ledger 中取 mapped/unresolved/conflict/excluded 之一。mapped/conflict 必须分别指向存在且同 key 的 finding/conflict；unresolved/excluded 必须解释原因；所有目标都必须被 ledger 引用。
6. finding 必须满足完整运行时合同：有限且位于 0..1 的 confidence、非空 refs 与 quoted evidence、固定四键且值为 yes/no/unknown 的 matrix。
7. 任一结构或目标校验失败即拒绝生成；不得输出 `closure_ok=true`。
8. `node index.js input.json report.html [generated_at]`；扩展名 `.json` 时输出同一 report model。

## HTML 合同
UTF-8 自包含；无外链、脚本、事件属性；包含身份/完整性、J1—J4 摘要、root causes、findings、unresolved、conflicts、mapping、judgement registry、trace。用户字段统一转义，状态和严重度有文字，长 ref 可换行、表格横向滚动、360px 可用、打印可读、所有列表有空态。
