# J5 Trace 根因与映射规则

## RULE-J5-000 映射闭包
先验证 J1—J4 都是当前完整输出，不接受空对象、截断结果或旧版摘要。J1 partial/fail/insufficient_evidence、J2 非 none、J3 partial/missing/insufficient_evidence、J4 rejected/conflict 都是 actionable judgement。每个 stable issue key 在 ledger 恰有一行：mapped 指向同 key finding，conflict 指向同 key 结构化冲突，unresolved/excluded 提供非空原因；不得遗漏、添加虚构 issue、使用空目标或留下未引用目标。

## RULE-J5-001 正确证据可用但未采用
正确证据节点、选择节点和最终报告齐全时归因 model；若 SP/Skill 明令错误口径，归因对应规则或 mixed。不能只凭最终答案错误归因。

## RULE-J5-002 输入缺少有效证据
检查调用参数、返回和错误状态，区分 source/tool；模型未尝试合理检索路径时可归因 model。证据不足则 owner=unknown，ledger=unresolved。

## RULE-J5-003 系统规则导致重复误判
须有规则原文、执行节点和重复样本，才能归因 system_prompt、skill 或 mixed。

## RULE-J5-004 稳定问题与共享根因
同一业务问题跨 J1/J2/J3 使用同一 stable_issue_key 并合并 finding，保留所有 judgement/evidence refs。多个不同 issue 可共享 root_cause_id；不得仅因共享根因合并 finding。

## RULE-J5-005 冲突不裁决
冲突保留双方 judgement refs、证据和摘要，ledger 标 conflict；J5 不覆盖任一上游结论。
