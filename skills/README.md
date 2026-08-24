# Tendata Trade Judger Skills

面向外贸数据分析评测的五个独立 Skill（腾道交付包）。运行时代码仅使用 Node.js 内置模块，不访问网络。

## 套件职责

| Skill | 实际职责 | 默认 CLI 产物 |
|---|---|---|
| `trade-j1-methodology` | 对已抽取的方法论维度做确定性合同校验与聚合评分 | `j1.json` |
| `trade-j2-fidelity` | 对已抽取的原子 Data Claim 做证据合同校验、偏差统计 | `j2.json` |
| `trade-j3-completeness` | 对已生成的任务契约做触发条件校验与覆盖率聚合 | `j3.json` |
| `trade-j4-pairwise-btd` | 校验 pairwise 比较并用 Davidson 平局扩展进行 BTD 排序 | `ranking.json` |
| `trade-j5-trace-html` | 汇总 J1—J4 actionable judgement、校验映射闭包并生成诊断 JSON/HTML | `trace-report.html` |

J1—J3 不从自然语言中自动抽取语义判断；语义抽取合同在各模块 `prompt.md`。`schema.json` 描述输入/输出接口，运行器执行自己的必要字段和枚举校验；本套件不声称实现完整 Draft 2020-12 Schema 引擎。

每个 Skill 包含 `SKILL.md`、`prompt.md`、`expert-rules.md`、`expert-cases.jsonl`、`schema.json`、`index.js`。共享运行依赖和演示输入位于 `shared/`。

## 环境

- Node.js 18 或更高版本；
- 零 npm 依赖，无需安装包；
- 离线运行。

## 一键轻量验收

```bash
node tools/acceptance.js
```

该命令依次执行：

1. `node tools/data-lint.js`：解析五模块 JSONL，检查案例 ID、规则引用、基础字段/枚举、规则案例覆盖；确定性案例带 `input` 时运行模块，semantic 案例只做合同 lint；同时检查 JSON/schema 基础语法和 schema 元信息。
2. `node demo.js`：从 `shared/examples/` 重新生成全部 `demo-output/`，避免手工维护产物漂移。
3. `node tools/clean-install.js`：安装到全新系统临时目录，require 五个模块并各启动一次 CLI，结束后删除临时目录。

返回码 `0` 表示三段全部通过。数据 lint 只做基础合同检查，不是完整 Draft Schema validation。

## 演示

```bash
node demo.js
```

演示每次先清空并重建 `demo-output/`，写出：

- `j1-model-a.json`、`j2-model-a.json`、`j3-model-a.json`；
- `j1-model-b.json`、`j2-model-b.json`、`j3-model-b.json`；
- `j4-pairs.json`、`ranking.json`；
- `j5.json`、`trace-report.html`；
- `test-summary.json`。

演示同时刷新派生的 `shared/examples/j5.json`。不要手工编辑 `demo-output/`；需要变更演示时修改 `demo.js` 或 `shared/examples/` 后重新运行。

## 单独运行

在本目录执行：

```bash
node trade-j1-methodology/index.js shared/examples/j1.json j1.json
node trade-j2-fidelity/index.js shared/examples/j2.json j2.json
node trade-j3-completeness/index.js shared/examples/j3.json j3.json
node trade-j4-pairwise-btd/index.js shared/examples/j4.json ranking.json
node trade-j5-trace-html/index.js shared/examples/j5.json trace-report.html
node trade-j5-trace-html/index.js shared/examples/j5.json j5.json
```

CLI 形式为 `node index.js <input.json> [output]`；J5 还支持第三个可选参数 `generated_at`。J5 根据输出扩展名选择 JSON 或自包含 HTML。

## 安装到项目

```bash
node /path/to/tendata-trade-judger-skills/install.js
node /path/to/tendata-trade-judger-skills/install.js /path/to/project/.trae/skills --verify
```

默认目标是当前目录 `.trae/skills/`。安装器复制五个 Skill 以及实际运行依赖 `shared/lib.js` 和共享示例；`--verify` 会从安装目标 require 五个入口。若要做隔离目录中的安装与 CLI 启动验收，运行 `node tools/clean-install.js`。

## 专家共创

先阅读 `EXPERT_CONTRIBUTION_GUIDE.md`。业务规则真源是各模块 `expert-rules.md`；`expert-cases.jsonl` 用于覆盖和校准规则边界，不替代规则文本。输出字段、权重、聚合或渲染变化仍由工程人员修改 `schema.json` / `index.js`。

## 证据纪律

1. 先定位证据，再下结论；负面判断必须带 `evidence_refs`。
2. 缺少证据时使用 `insufficient_evidence`，不得用常识补写。
3. Critical failure 不得被平均分抵消。
4. 篇幅、引用数和工具调用数本身不构成质量优势。
5. J5 只融合和归因，不修改 J1—J4 的原始结论。
