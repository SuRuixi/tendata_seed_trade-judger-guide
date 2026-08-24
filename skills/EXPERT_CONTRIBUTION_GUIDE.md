# 腾道外贸数据专家共创指南

这套 Skill 把腾道外贸数据专家的判断方法沉淀为可追踪规则和校准案例。专家主要维护业务原则、严重度、证据要求、例外与案例边界；工程人员维护字段协议、聚合算法和运行代码。

## 真源与文件边界

- 每个模块的 `expert-rules.md` 是业务判断规则真源。规则的适用条件、正确判断、严重度、证据与例外应在这里写完整。
- `expert-cases.jsonl` 是规则覆盖与边界校准集，不是第二份规则真源。案例与规则冲突时先修正规则或确认规则解释，再同步案例。
- `prompt.md` 负责把自然语言材料抽取成运行器消费的结构；`schema.json` / `index.js` 负责机器接口、确定性校验和聚合。
- README 只解释套件用法，不承载业务判定规则。

## 先判断要改哪一层

| 发现的问题 | 修改位置 | 工程支持 |
|---|---|---|
| 缺少或误写外贸判断原则 | `expert-rules.md`，并补案例 | 通常不需要 |
| 某种情况经常被误判 | `expert-rules.md` + `expert-cases.jsonl` | 通常不需要 |
| Judger 未抽取应检查对象 | `prompt.md` | 建议协作 |
| 严重度或计分权重实现不合理 | `index.js` | 需要 |
| 输出字段或枚举变化 | `schema.json` + `index.js` | 需要 |
| HTML 报告栏目变化 | J5 `index.js` | 需要 |

## 案例三类边界

每行是一个 JSON 对象。共同必要字段是 `case_id`、`rule_id`、`reason`，并至少包含 `expected` 或一个 `expected_*` 字段。`case_id` 在五模块全局唯一，`rule_id` 必须存在于同模块 `expert-rules.md`。

`case_type` 可取：

- `semantic`：默认类型。输入是自然语言摘要或专家情境，期望是语义判断边界。轻量 runner 只检查合同、枚举和规则引用，不声称自动判断语义正确性；此类案例需由 Judger/专家评审。
- `deterministic`：可由现有 `index.js` 稳定执行的结构化案例。若提供 `input`，runner 会调用模块导出的 `evaluate(input)`；可提供 `expected_output`，runner 对指定字段做递归子集比对。不要把需要自然语言理解的案例标成 deterministic。
- `manual`：需要网页、附件、人工比对或当前 runner 不具备的外部上下文。runner 只 lint 合同，验收结果必须由人工记录，不得冒充自动通过。

未写 `case_type` 的存量案例按 `semantic` 处理。`semantic` 和 `manual` 即使通过 data lint，也只表示案例文件合同合法，不表示业务期望已被模型自动验证。

示例：

```json
{"case_id":"J1-001-P","rule_id":"RULE-J1-001","case_type":"semantic","input_summary":"出口缺失，使用伙伴国进口并披露 CIF/FOB 调整","expected":"pass","reason":"替代路径与限制均可复核"}
```

确定性案例可写成：

```json
{"case_id":"J4-D001","rule_id":"RULE-J4-006","case_type":"deterministic","input":{"models":["a","b"],"comparisons":[]},"expected_output":{"status":"insufficient_comparisons"},"reason":"空比较集不生成排名结论"}
```

只有当 `input` 满足当前模块真实接口时才加入此类案例；不要为了让案例运行而发明另一套 envelope 或 schema 引擎。

## 规则写法

规则标题使用现有编号，例如：

```markdown
### RULE-J1-001 镜像数据不能直接等同官方出口

- 适用条件：报告国出口数据缺失，模型改用伙伴国进口。
- 正确判断：允许作为替代估算，但必须检查 CIF/FOB、伙伴覆盖率、再出口和时滞。
- 严重度建议：缺少一项为 partial；完全不披露镜像口径为 major fail。
- 必需证据：检索结果、伙伴范围、变换过程、报告披露。
- 例外：用户只要求粗略方向判断，且明确接受估算。
- 反例：仅因为使用镜像数据就直接判 fail。
```

新增规则必须至少有一个案例覆盖；关键规则建议同时提供正例、反例和边界例。模板占位编号（如 `RULE-J1-XXX`）不是生效规则，也不得被案例引用。

## 推荐工作流

1. 选择出现问题的 Judger，先确认对应规则真源。
2. 修正规则的条件、判断、证据、严重度和例外。
3. 为规则增加 semantic、deterministic 或 manual 案例，类型按实际可验证边界选择。
4. 运行 `node tools/data-lint.js`，修复 JSONL、引用、枚举和覆盖问题。
5. 需要全套确认时运行 `node tools/acceptance.js`；它会刷新 demo 产物并做干净安装验证。
6. 语义案例由 Judger 与专家比较实际输出和预期；data lint 通过不能替代这一步。
7. 若规则正确但字段、分数或渲染仍不合理，交由工程人员修改代码。

## 五个 Judger 的专家关注点

- J1：分析方法是否成立，包括定义、来源、缺失、变换、计算和验证。
- J2：报告中的每个 Data Claim 是否忠实于来源和变换。
- J3：报告是否完整回答任务，包括条件触发后的必需披露。
- J4：两个结果发生权衡时，什么错误应优先，以及何时应判 Same。
- J5：问题应归因给模型、来源、工具、SP、Skill 还是混合原因。

## 不建议专家直接修改

- `schema.json`：机器接口；
- `index.js`：校验、聚合、计分和 HTML 渲染；
- `shared/lib.js`、`install.js`、`tools/`：公共运行与验收工具。

需要修改这些文件时，先提交业务规则和期望案例，由工程人员实现并运行验收。
