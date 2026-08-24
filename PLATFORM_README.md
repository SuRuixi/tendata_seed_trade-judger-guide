# Tendata Trade Judger · 评测平台交付

本仓库集成三部分资产：

| 目录 | 内容 |
|---|---|
| `index.html` · `_shared/` · `assets/` | 共建计划指南（GitHub Pages 站点） |
| `platform/` | 评测平台（前端 SPA + FastAPI 网关，可直接对腾道 AI 产出的 traces/outputs 做 J1—J5 打分） |
| `skills/` | 官方 Skill 包（trade-j1 ~ trade-j5，含 SKILL.md / prompt.md / schema.json / index.js / expert-rules.md / expert-cases.jsonl） |

## 快速上手评测平台

```bash
# 1) 启动 FastAPI 网关（调用 LLM 抽取 + Node CLI 打分）
cd platform/server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787 --reload

# 2) 启动静态前端
cd ../..
python3 -m http.server 8080 -d platform

# 3) 浏览器访问
open http://localhost:8080/index.html
```

在页面 ③ Judger 配置 里填入火山方舟或 OpenAI 兼容 API Key，即可对上传的 traces/outputs 做真实评估。

## 平台核心能力

- **① 批量上传评估**：支持多文件 / 文件夹 / JSONL / 拖拽，逐任务流式打印 LLM 抽取与 J1—J5 打分过程。
- **② 规则管理**：内置官方 5 层共 57 条规则（由 `platform/tools/bake.js` 从 `skills/trade-j*/expert-rules.md` 烘焙），可搜索、过滤、编辑、导入导出、逐条启停。
- **③ Judger 配置**：切换 Provider / Model ID / API Key / 协议（chat vs responses） / 温度 / 超时 / 并发；支持 fallback 模型。
- **🧠 综合分析**：一键调用 Judger 对本批全部评估结果做跨任务/跨模型综合分析，输出学术化 Markdown 报告。

## 目录结构

```
platform/
├── index.html            # 单页 SPA
├── assets/               # 样式与工具函数
├── data/                 # 烘焙好的规则 / 案例 / 演示评测结果
├── sample_inputs/        # irab-30tasks 抽样的 10 份 trace/output 示例
├── tools/
│   └── bake.js           # 从 skills/ 烘焙 rules.json + cases.jsonl
└── server/
    ├── main.py           # FastAPI 网关
    ├── requirements.txt
    └── README.md
skills/
├── trade-j1-methodology/
├── trade-j2-fidelity/
├── trade-j3-completeness/
├── trade-j4-pairwise-btd/
├── trade-j5-trace-html/
├── shared/
├── tools/
└── demo-output/
```
