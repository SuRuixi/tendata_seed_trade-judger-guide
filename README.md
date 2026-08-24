# Tendata Trade Judger · 外贸 Agent 评测框架与平台

面向外贸场景 AI Agent 的正交五层评测体系。仓库同时提供**共建计划指南**、**官方 Skill 包**与**可交付的评测平台**，用于对腾道 AI 或第三方 Agent 产出的 trace 与 report 进行 J1—J5 打分、跨模型对比与诊断追溯。

---

## 一、评测框架

采用五层正交结构，各层职责严格分离：

| 层 | 目标 | 核心产物 |
| :- | :- | :- |
| **J1 · 方法论（Methodology）** | 六维评估外贸分析方法是否成立：`problem_definition / source_strategy / missing_data / transformation / calculation / validation` | `methodology_score` · `evidence_coverage` · `critical_failure` |
| **J2 · 数据忠实度（Fidelity）** | 逐条 Data Claim 核验来源、单位、口径与计算公式；聚合为加权偏差率 WDR | `weighted_deviation_rate` · 逐 claim `deviation / severity` |
| **J3 · 任务完整度（Completeness）** | 检查任务契约每一条 required deliverable 的覆盖态；`should_generate` 与验收态严格正交 | `overall_score` · `covered / total` · 逐契约 `status` |
| **J4 · Pairwise BTD** | 用 Davidson BTD 模型对多模型 pairwise 比较结果做 MLE，输出偏好排序 | `ranking` · `eta` · `log_likelihood` |
| **J5 · 诊断追溯（Trace）** | 依托 J1—J4 产物构造 stable issue key（SIK）闭包，产出 findings 与 mapping ledger | `findings` · `mapping_ledger` · `closure_ok` |

**硬性约束**：

- 正交性：各层严禁跨界判定（如 J1 不介入 J2 的数据核验）。
- 数据同源：JSON 与 HTML 报告必须基于同一 Report Model。
- 规则模板占位：`RULE-JX-XXX` 仅供占位，不产生逻辑效力。
- 案例校准：J1/J2/J3 由专家深度共创规则与案例；J4/J5 侧重工程执行契约。

---

## 二、仓库结构

```
tendata_seed_trade-judger-guide/
├── index.html                    # 共建计划指南（GitHub Pages）
├── README.md                     # 本文件
├── PLATFORM_README.md            # 平台部署说明
├── .gitignore
├── _shared/  assets/             # 指南页面资产
│
├── platform/                     # 评测平台（前端 SPA + FastAPI 网关）
│   ├── index.html                # 单页应用（① 批量上传评估 · ② 规则管理 · ③ Judger 配置）
│   ├── data/                     # 烘焙好的规则 / 案例 / 演示评测结果
│   ├── sample_inputs/            # 抽样 10 份 kimi-k3 / qwen3.8-max 真实 trace/output
│   ├── tools/bake.js             # 从 skills/ 解析 rules.json + cases.jsonl
│   └── server/
│       ├── main.py               # FastAPI 网关：LLM 抽取 + Node CLI 调度
│       └── requirements.txt
│
└── skills/                       # 官方 Skill 包
    ├── trade-j1-methodology/     # 每层 6 件套：SKILL.md · prompt.md · schema.json ·
    ├── trade-j2-fidelity/        #   index.js · expert-rules.md · expert-cases.jsonl
    ├── trade-j3-completeness/
    ├── trade-j4-pairwise-btd/
    ├── trade-j5-trace-html/
    ├── shared/  tools/           # 共享 lib + acceptance / data-lint
    └── demo-output/              # 官方 J1—J5 演示输出，用于回归基线
```

---

## 三、快速上手

### 3.1 启动评测平台

```bash
git clone https://github.com/SuRuixi/tendata_seed_trade-judger-guide.git
cd tendata_seed_trade-judger-guide

# 后端网关（Python 3.10+）
cd platform/server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787 --reload

# 前端（新终端）
cd ..
python3 -m http.server 8080

# 浏览器
open http://localhost:8080/index.html
```

在页面 **③ Judger 配置** 填入火山方舟或 OpenAI 兼容 API Key。顶栏应出现绿色圆点「Gateway 在线」。

### 3.2 官方 Skill 包直调

```bash
cd skills
node install.js       # 首次执行
node demo.js          # 用 shared/examples 跑一次 J1—J5 全链路，落盘到 demo-output/
```

---

## 四、平台核心能力

| 功能 | 说明 |
| :- | :- |
| **批量上传评估** | 支持多文件 / 文件夹 / JSONL / 拖拽；上限 500 条；单文件包含 `task_id / model_id / trace / output` 或已抽取好的 `j1_input / j2_input / j3_input` |
| **流式评估** | SSE 逐层推送 8 类事件（`layer_start / layer_progress / layer_done / layer_error / layer_skip / task_done / all_done`），实时打印 LLM 抽取字节数与 Node CLI 结果 |
| **规则管理** | 内置官方 5 层共 **57 条规则**（由 `platform/tools/bake.js` 从 `skills/trade-j*/expert-rules.md` 烘焙），全 8 字段（主维度 / 适用条件 / 正确判断 / 严重度 / 必需证据 / 例外 / 反例 / 官方原文），支持增删改查、启停、导入导出 |
| **Judger 配置** | Provider（Volcengine Ark / OpenAI / Anthropic / DeepSeek / Moonshot / Custom）· Model ID · API Key · API 协议（chat vs responses · 自动路由）· 温度 · max_tokens · 超时 · 并发 · Fallback 模型 |
| **单任务 Markdown 报告** | 每份任务生成含总览表 / 六维评估 / 逐 claim 核验 / 契约覆盖 / findings / mapping ledger 的完整 Markdown 报告；支持 ↓Markdown 与 ↓HTML 导出 |
| **🧠 综合分析** | 一键调用 Judger 对本批全部真实评估结果做跨任务/跨模型综合分析，输出学术风格 Markdown 报告：总体表现 · 跨模型对比 · 层间归因 · 失败模式 · 改进建议 · 置信度 |
| **本地会话持久化** | 文件列表 / 层勾选 / 控制台日志 / 评估结果保存在 localStorage；切换 tab、刷新页面均可恢复 |

---

## 五、专家共建工作流

腾道方与算法方共同维护规则与案例：

1. **克隆本仓库**并切到工作分支。
2. 在 `skills/trade-jX-.../expert-rules.md` 追加或编辑 `### RULE-JX-NNN` 段（保持 `主维度 / 适用条件 / 正确判断 / 严重度建议 / 必需证据 / 例外 / 反例` 七字段结构）。
3. 在 `skills/trade-jX-.../expert-cases.jsonl` 追加对应案例（每行一个 JSON，含 `case_id / rule_id / input / expected_output`）。
4. 运行 `node skills/tools/data-lint.js` 校验规则/案例语法。
5. 运行 `node platform/tools/bake.js` 重烘焙 `platform/data/rules.json`（前端「规则管理」页立即刷新）。
6. 提 PR。

详见 [EXPERT_CONTRIBUTION_GUIDE.md](./skills/EXPERT_CONTRIBUTION_GUIDE.md)。

---

## 六、示例数据

`platform/sample_inputs/` 内含 10 份来自 `irab-30tasks` 的真实 trace/output（5 任务 × 2 模型 · kimi-k3 与 qwen3.8-max）。上传后即可跑通全链路，用于验证：

- LLM 抽取是否连通（Responses API 或 Chat Completions）。
- Node CLI 是否成功产出 J1/J2/J3/J5 打分。
- 综合分析报告是否符合腾道对 Markdown 输出的编辑纪律。

---

## 七、写作与产出纪律

对外文档与报告统一遵循：

- 使用「」代替双引号。
- 禁止使用「不是……而是……」句式。
- 风格严谨、专业、学术化，追求高信息密度。
- 判断必须落到具体数值或任务 ID，避免空泛评价。
- 严格过滤敏感信息（人名、内部汇报流程、返利条款等）。

---

## 八、版权与联系

评测框架与 Skill 包由字节跳动 · 火山方舟 与腾道 AI 联合维护。技术问题请在本仓库 Issues 中提交。
