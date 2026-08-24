# J4 Pairwise 比较规则

### RULE-J4-001 Critical gate 可执行
- 先记录 `critical_gate.result` 与 `a_refs/b_refs`。单侧存在任务核心 critical 时，该侧不得获胜；双方均有时比较严重度，否则 `Same/incomparable`。
- `clear` 表示双方均无核心 critical；未完成审查用 `not_assessed`，不得伪装 clear。

### RULE-J4-002 底层问题去重
- J1 方法错误与 J2 忠实度错误若来自同一底层问题，`judgement_refs` 可列两处，但只给一个稳定 `root_issue_key`，只算一个决定维度。
- 不以诊断器数量或引用数量加权。

### RULE-J4-003 双侧证据与偏序
- 非 Same 必须给双方可定位证据，说明赢家做对了什么、输家差在哪里；只给输家证据不足以建立比较。
- 一方在任务关键维度不差且至少一项实质更好才构成支配。篇幅、版式、工具数不构成优势。

### RULE-J4-004 Same 三分
- `equivalent`：双方实质交付等价。
- `incomparable`：环境、可用输入或关键 trade-off 不可公度。
- `insufficient_evidence`：没有足够双侧证据建立差异。

### RULE-J4-005 Pair 身份与 swap
- 同一 `task_id + unordered pair` 仅一个 primary。重复同向输入去重；反向 primary 副本拒绝。
- swap check 必须交换 A/B 并反转 A/B outcome，Same 保持；仅计测试，不计 BTD 票。

### RULE-J4-006 有限参数与结果状态
- confidence 0.05..1，weight 0.1..5，默认 weight=1；超参数严格落在 schema 范围。
- 全部有效票均 Same 时状态 `all_same`；模型比较图不连通为 `disconnected`；无票或节点票数不足为 `insufficient_comparisons`；只有充分且连通时为 `ranked`。
