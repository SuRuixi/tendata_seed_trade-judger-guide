# Tendata Trade Judger · FastAPI 网关

FastAPI 后端，连通前端上传与真实 J1—J5 评测流水线。

## 架构

```
浏览器 (index.html)
    │  POST /evaluate  { tasks, layers, config }
    ▼
FastAPI (main.py) ── 调用 LLM (Volcengine Ark / OpenAI / DeepSeek ...)
    │                完成 prompt.md 结构化抽取
    ▼
subprocess: node trade-jX/index.js  ──> 确定性打分 JSON
    │
    ▼
汇总为 { task_id, model_id, layers: { j1: {score,...}, j2: {...} } }
```

## 启动

```bash
cd tendata_platform/server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8787 --reload
```

启动后访问 <http://localhost:8787/docs> 查看交互式 API 文档。

## 环境要求

- Python 3.9+
- Node.js 18+（用于执行 Skill CLI）
- Skill 包位于 `../../tendata-trade-judger-skills(1)/tendata-trade-judger-skills/`

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/health`             | 健康检查，返回 Skill 包检测结果 |
| POST | `/test-connection`    | 用当前配置调用一次 LLM，返回延迟 |
| POST | `/evaluate`           | JSON 批量评估（前端主用） |
| POST | `/evaluate/upload`    | multipart 文件上传评估 |

## 输入格式（单任务）

```json
{
  "task_id": "trade-demo-001",
  "model_id": "model-a",
  "trace":  "…原始 trace 文本…",
  "output": "…模型报告…",
  "j1_input": null,
  "j2_input": null,
  "j3_input": null
}
```

若前端已完成抽取（例如已有 `j1-model-a.json` 六维结构），可直接放到 `j1_input` 字段中，后端将跳过 LLM 抽取，仅调用 CLI 打分。

## 安全

- API Key 通过请求体传递，服务器不写盘，进程结束后即销毁。
- 运行产物保存在 `server/runs/<timestamp>/`，供事后回溯。
- 默认开放 CORS `*`，生产部署请收紧到前端域名。
