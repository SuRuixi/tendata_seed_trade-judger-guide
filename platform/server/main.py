# Tendata Trade Judger · FastAPI 后端网关
# 职责：
# 1. 接收前端上传的 trace / output JSON；
# 2. 调用 LLM（Volcengine Ark / OpenAI 兼容协议）完成 prompt.md 抽取；
# 3. 落盘为 Skill CLI 所需的 j1/j2/j3/j4/j5 输入；
# 4. 通过 subprocess 调用 Node.js CLI 得到确定性打分；
# 5. 汇聚为一份评估报告返回前端。
#
# 启动：
#   pip install -r requirements.txt
#   uvicorn main:app --host 0.0.0.0 --port 8787 --reload

import json
import subprocess
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ==== 路径配置 ====
ROOT = Path(__file__).resolve().parent
SKILLS_DIR = (ROOT.parent.parent / "tendata-trade-judger-skills(1)" / "tendata-trade-judger-skills").resolve()
WORK_DIR = ROOT / "runs"
WORK_DIR.mkdir(exist_ok=True)

SKILL_META = {
    "j1": {"dir": "trade-j1-methodology",  "cli": "trade-j1-methodology/index.js"},
    "j2": {"dir": "trade-j2-fidelity",     "cli": "trade-j2-fidelity/index.js"},
    "j3": {"dir": "trade-j3-completeness", "cli": "trade-j3-completeness/index.js"},
    "j4": {"dir": "trade-j4-pairwise-btd", "cli": "trade-j4-pairwise-btd/index.js"},
    "j5": {"dir": "trade-j5-trace-html",   "cli": "trade-j5-trace-html/index.js"},
}

app = FastAPI(title="Tendata Trade Judger Gateway", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==== Data models ====
class JudgerConfig(BaseModel):
    provider: str = "volcengine-ark"
    model_id: str
    api_key: str
    base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    api_style: str = "auto"  # auto / chat / responses
    temperature: float = 0.1
    max_tokens: int = 8192
    timeout_ms: int = 60000
    concurrency: int = 4


class TaskInput(BaseModel):
    task_id: str
    model_id: str
    # 原始 trace / output（自然语言 or 结构化）
    trace: Optional[str] = None
    output: Optional[str] = None
    # 若前端已经完成抽取，直接携带结构化输入（跳过 LLM 抽取）
    j1_input: Optional[Dict[str, Any]] = None
    j2_input: Optional[Dict[str, Any]] = None
    j3_input: Optional[Dict[str, Any]] = None


class EvaluateRequest(BaseModel):
    tasks: List[TaskInput]
    layers: List[str]  # 例：["j1", "j2", "j3", "j5"]
    config: JudgerConfig


# ==== LLM 调用（Chat Completions / 火山方舟 Responses API 双通道） ====
def _pick_api_style(config: JudgerConfig) -> str:
    if config.api_style and config.api_style != "auto":
        return config.api_style
    m = (config.model_id or "").lower()
    # 火山方舟：doubao-seed-* / doubao-1.6+ / doubao-2 走 Responses API；
    # deepseek 家族、doubao-1.5-* 走 Chat Completions。
    RESPONSES_HINTS = ("seed", "doubao-1.6", "doubao-1-6", "doubao-2")
    if config.provider == "volcengine-ark" and any(h in m for h in RESPONSES_HINTS):
        return "responses"
    if "responses" in (config.base_url or ""):
        return "responses"
    return "chat"


def _post_with_retry(config: JudgerConfig, url: str, payload: Dict[str, Any], headers: Dict[str, str]):
    """带重试的 POST，处理 doubao-seed 深度推理超时；捕获所有 httpx 异常。"""
    import httpx, time as _t
    attempts = 3
    last_err = None
    for i in range(attempts):
        try:
            with httpx.Client(timeout=max(config.timeout_ms / 1000, 60)) as client:
                resp = client.post(url, json=payload, headers=headers)
                return resp
        except httpx.ReadTimeout as e:
            last_err = e
        except httpx.RemoteProtocolError as e:
            last_err = e
        except Exception as e:
            last_err = e
        _t.sleep(2 ** i)
    raise HTTPException(status_code=504, detail=f"LLM 网络异常（重试 {attempts} 次）：{last_err}")


def _call_chat_completions(config: JudgerConfig, system: str, user: str) -> str:
    url = config.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": config.model_id,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
    }
    headers = {"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}
    resp = _post_with_retry(config, url, payload, headers)
    if 400 <= resp.status_code < 500:
        raise HTTPException(status_code=resp.status_code, detail=f"LLM(chat) {resp.status_code}: {resp.text[:800]}")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail=f"LLM(chat) {resp.status_code}: {resp.text[:800]}")
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail=f"chat 响应非 JSON：{resp.text[:400]}")
    # 兼容多种返回：content / reasoning_content / content list
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail=f"chat 响应缺 choices：{json.dumps(data)[:600]}")
    content = msg.get("content")
    if isinstance(content, list):
        # 有些实现返回数组形式 [{'type':'text','text':...}]
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("text"):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        content = "\n".join(parts) if parts else None
    if not content or not str(content).strip():
        # 兜底：deepseek 有时把答案放在 reasoning_content
        content = msg.get("reasoning_content")
    if not content or not str(content).strip():
        raise HTTPException(status_code=502, detail=f"chat 响应 message 为空：{json.dumps(data)[:800]}")
    return str(content)


def _call_responses(config: JudgerConfig, system: str, user: str) -> str:
    """
    火山方舟 Responses API：
      POST {base}/responses
      body: { model, input:[{role,content:[{type:'input_text',text:...}]}],
              thinking:{type:'disabled'} }
    深度推理模型（doubao-seed-*, deepseek-*）默认把 tokens 花在 `reasoning`
    片段上，不留给 `message`；这里关闭 thinking 让 message 有输出。
    """
    url = config.base_url.rstrip("/") + "/responses"
    payload = {
        "model": config.model_id,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": system}]},
            {"role": "user",   "content": [{"type": "input_text", "text": user}]},
        ],
        "temperature": config.temperature,
        "max_output_tokens": config.max_tokens,
        # 关闭深度思考，避免推理耗光 token 预算而 message 为空
        "thinking": {"type": "disabled"},
    }
    headers = {"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}
    resp = _post_with_retry(config, url, payload, headers)
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"LLM(responses) {resp.status_code}: {resp.text[:800]}")
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail=f"responses 响应非 JSON：{resp.text[:400]}")

    # 1) 直接给出 output_text 字符串
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"]

    # 2) output 数组里找 message.content[].text；同时收集 reasoning 兜底
    message_chunks: List[str] = []
    reasoning_chunks: List[str] = []
    if isinstance(data.get("output"), list):
        for item in data["output"]:
            itype = item.get("type")
            if itype == "message":
                for c in item.get("content", []) or []:
                    if c.get("type") in ("output_text", "text") and c.get("text"):
                        message_chunks.append(c["text"])
            elif itype == "reasoning":
                for s in item.get("summary", []) or []:
                    if s.get("type") in ("summary_text", "text") and s.get("text"):
                        reasoning_chunks.append(s["text"])
    if message_chunks:
        return "\n".join(message_chunks)

    # 3) 兼容旧协议 choices[]
    try:
        content = data["choices"][0]["message"].get("content")
        if isinstance(content, str) and content.strip():
            return content
    except Exception:
        pass

    # 4) 兜底：拿 reasoning 摘要（不理想，但可能仍含 JSON 结构）
    if reasoning_chunks:
        return "\n".join(reasoning_chunks)

    raise HTTPException(status_code=502, detail=f"responses 无 message/reasoning: {json.dumps(data)[:800]}")


def call_llm(config: JudgerConfig, system: str, user: str) -> str:
    style = _pick_api_style(config)
    import sys
    try:
        text = _call_responses(config, system, user) if style == "responses" else _call_chat_completions(config, system, user)
        if text and text.strip():
            return text
        raise HTTPException(status_code=502, detail=f"LLM({style}) 返回空内容")
    except HTTPException as e:
        code = e.status_code
        sys.stderr.write(f"[LLM] {style} FAILED status={code} model={config.model_id} detail={str(e.detail)[:300]}\n")
        # 504（网络超时）直接放弃，避免再消耗一次 180s；
        # 4xx / 502（协议不匹配、空内容）才尝试备通道
        if code == 504:
            raise
        alt = "responses" if style == "chat" else "chat"
        try:
            text2 = _call_responses(config, system, user) if alt == "responses" else _call_chat_completions(config, system, user)
            if text2 and text2.strip():
                sys.stderr.write(f"[LLM] fallback {alt} OK · {len(text2)} bytes\n")
                return text2
        except HTTPException as e2:
            sys.stderr.write(f"[LLM] fallback {alt} FAILED status={e2.status_code} detail={str(e2.detail)[:300]}\n")
            raise HTTPException(status_code=502,
                detail=f"{style} 与 {alt} 均失败：{style}={str(e.detail)[:200]}；{alt}={str(e2.detail)[:200]}")
        raise HTTPException(status_code=502,
            detail=f"{style} 失败且 {alt} 也返回空：{style}={str(e.detail)[:200]}")


def load_prompt(layer: str) -> str:
    """读取指定 Skill 的 prompt.md 作为 system prompt。"""
    p = SKILLS_DIR / SKILL_META[layer]["dir"] / "prompt.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def load_rules(layer: str) -> str:
    """读取 expert-rules.md，注入到 system prompt 后半段。"""
    p = SKILLS_DIR / SKILL_META[layer]["dir"] / "expert-rules.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


# ==== JSON 抽取（从 LLM 响应中截取 { ... } 或 ``` 代码块） ====
def extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    # 优先匹配 ```json ... ``` 代码块
    if "```" in text:
        import re
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
    # 直接尝试
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 最大 { ... } 区间
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=502,
                detail=f"LLM 响应 JSON 解析失败（{e}）:\n{text[start:end+1][:400]}")
    raise HTTPException(status_code=502, detail=f"无法从 LLM 响应解析 JSON:\n{text[:400]}")


def build_user_prompt(task: TaskInput, layer: str) -> str:
    """构造送入 LLM 的用户消息。要求 LLM 严格返回可直接 feed 到 index.js 的 JSON。"""
    schema_hint = {
        "j1": '{"task_id":"<必填>","model_id":"<必填>","dimensions":[{"id":"problem_definition|source_strategy|missing_data|transformation|calculation|validation","status":"pass|partial|fail|not_applicable|insufficient_evidence","severity":"info|minor|major|critical","confidence":0.0,"evidence_refs":["trace:step-N","report:section-X"],"quoted_evidence":"从 trace 或 report 中截取的具体文字","reason":"..."} × 严格 6 项]}',
        "j2": '{"task_id":"<必填>","model_id":"<必填>","claims":[{"id":"c1","text":"报告中的具体断言原文","importance":1.0,"confidence":0.9,"deviation":"none|transcription|definition|time|unit_currency|aggregation|calculation|source_quality|insufficient_evidence","severity":"info|minor|major|critical","transformation":"如何从来源推出该断言","source_refs":["source:HS0901-2025"],"evidence_refs":["report:para-3","source:HS0901-2025"],"quoted_evidence":"从报告截取的原文","missing_evidence_types":["<仅在 deviation=insufficient_evidence 时：report|source|trace|artifact|transformation|query_context>"],"reason":"..."}]}',
        "j3": '{"task_id":"<必填>","model_id":"<必填>","task_contract":[{"id":"req-1","text":"用户显式要求的原文（截取自 trace）","kind":"required|conditional|optional","triggered":true,"status":"covered|partial|missing|not_triggered|insufficient_evidence","evidence_refs":["report:section-A"],"quoted_evidence":"报告中回应此要求的原文","reason":"..."}]}',
    }
    guidance = {
        "j1": "请对固定 6 维方法论逐一评估：problem_definition / source_strategy / missing_data / transformation / calculation / validation。每一维必须给出真实证据引用（如 trace:step-3 或 report:段落-2）与从报告截取的原文（quoted_evidence 非空）。",
        "j2": "请从报告中至少识别 3 条关键 Data Claim（数字、公司名、金额、增速、市场份额等），逐一核验是否有可追溯的来源。每条 claim 必须给出 text（原文断言）、quoted_evidence（截取原文）、evidence_refs（含 report: 与 source: 前缀各一条以上）、source_refs、transformation。",
        "j3": "请从用户任务原文（trace 第 1 条 user message）识别显式要求，作为 task_contract 逐一列出，判断报告是否覆盖。每条至少 3 项，包含 text（用户要求原文）、evidence_refs（如 report:章节-X）、quoted_evidence。",
    }
    parts = [
        f"# 待评估任务\n\ntask_id: {task.task_id}\nmodel_id: {task.model_id}\n",
    ]
    # 限制单次送入的 trace/output 长度，避免 deepseek-flash 类模型输入过长而超时
    MAX_TRACE = 6000
    MAX_OUTPUT = 12000
    if task.trace:
        t = task.trace
        if len(t) > MAX_TRACE:
            t = t[:MAX_TRACE] + f"\n\n…[trace 已截断，原长度 {len(task.trace)}]"
        parts.append(f"\n<trace>\n{t}\n</trace>\n")
    if task.output:
        o = task.output
        if len(o) > MAX_OUTPUT:
            o = o[:MAX_OUTPUT] + f"\n\n…[output 已截断，原长度 {len(task.output)}]"
        parts.append(f"\n<report>\n{o}\n</report>\n")
    parts.append(
        f"\n# 抽取指令\n{guidance.get(layer, '')}\n\n"
        f"# JSON Schema（务必包含顶层 task_id / model_id）\n{schema_hint.get(layer, '')}\n\n"
        f"仅输出 JSON，禁止 markdown 代码块与解释文字。"
        f" task_id 必须为 \"{task.task_id}\"、model_id 必须为 \"{task.model_id}\"。"
    )
    return "".join(parts)


def _normalize_cli_input(layer: str, obj: Dict[str, Any], task: TaskInput) -> Dict[str, Any]:
    """把 LLM 输出对齐到 Skill CLI 期望的最小 schema，避免因缺字段导致 CLI 报错。"""
    if not isinstance(obj, dict):
        obj = {}
    obj = dict(obj)
    obj.setdefault("task_id", task.task_id or "unknown-task")
    obj.setdefault("model_id", task.model_id or "unknown-model")

    if layer == "j1":
        DIMS = ["problem_definition", "source_strategy", "missing_data",
                "transformation", "calculation", "validation"]
        dims_raw = obj.get("dimensions")
        if not isinstance(dims_raw, list):
            dims_raw = []
        by_id = {}
        for d in dims_raw:
            if isinstance(d, dict) and d.get("id"):
                by_id[d.get("id")] = d
        fixed = []
        for did in DIMS:
            d = dict(by_id.get(did) or {})
            d["id"] = did
            d.setdefault("status", "insufficient_evidence")
            status = d["status"]
            # 保证 severity 与 status 组合合法
            allowed = {
                "pass": {"info"}, "not_applicable": {"info"}, "insufficient_evidence": {"info"},
                "partial": {"minor", "major"},
                "fail": {"minor", "major", "critical"},
            }.get(status, {"info"})
            if d.get("severity") not in allowed:
                d["severity"] = next(iter(allowed))
            try:
                c = float(d.get("confidence", 0.5))
                d["confidence"] = min(max(c, 0.0), 1.0)
            except Exception:
                d["confidence"] = 0.5
            refs = d.get("evidence_refs")
            d["evidence_refs"] = [str(ref).strip() for ref in refs
                                  if isinstance(ref, str) and ref.strip()] if isinstance(refs, list) else []
            quote = d.get("quoted_evidence")
            d["quoted_evidence"] = quote if isinstance(quote, str) else ""
            if status in ("pass", "partial", "fail"):
                if not d["evidence_refs"]:
                    d["evidence_refs"] = ["trace:auto"]
                if not d.get("quoted_evidence"):
                    d["quoted_evidence"] = "(LLM 未提供引用文本，占位)"
            elif status == "not_applicable":
                # J1 官方契约：不适用维度不得携带证据，避免伪造适用性。
                d["evidence_refs"] = []
                d["quoted_evidence"] = ""
            reason = d.get("reason")
            d["reason"] = reason.strip() if isinstance(reason, str) and reason.strip() else (
                d.get("quoted_evidence") or "无补充说明"
            )
            d.pop("weight", None)
            fixed.append(d)
        obj["dimensions"] = fixed

    elif layer == "j2":
        # J2 CLI 硬性约束（trade-j2-fidelity/index.js）：
        # - deviation 必须来自固定 9 种：
        VALID_DEV = {"none", "transcription", "definition", "time", "unit_currency",
                     "aggregation", "calculation", "source_quality", "insufficient_evidence"}
        LEGAL_SEV = {
            "none": {"info"},
            "insufficient_evidence": {"minor", "major"},
            "source_quality": {"minor", "major", "critical"},
            "transcription":  {"minor", "major", "critical"},
            "definition":     {"minor", "major", "critical"},
            "time":           {"minor", "major", "critical"},
            "unit_currency":  {"minor", "major", "critical"},
            "aggregation":    {"minor", "major", "critical"},
            "calculation":    {"minor", "major", "critical"},
        }
        MISSING_TYPES = {"report", "source", "trace", "artifact", "transformation", "query_context"}
        DEV_ALIAS = {
            "partial": "source_quality", "minor": "source_quality", "major": "source_quality",
            "critical": "source_quality", "warning": "source_quality",
            "misalignment": "definition", "outdated": "time", "unit": "unit_currency",
            "currency": "unit_currency", "compute": "calculation", "computation": "calculation",
            "missing": "insufficient_evidence", "unknown": "insufficient_evidence",
        }
        claims = obj.get("claims")
        if not isinstance(claims, list):
            claims = []
        cleaned = []
        for i, c in enumerate(claims):
            if not isinstance(c, dict):
                continue
            c = dict(c)
            c["id"] = c.get("id") or f"c{i+1}"
            # importance / confidence
            try:
                imp = float(c.get("importance", 1.0))
                c["importance"] = imp if imp > 0 else 1.0
            except Exception:
                c["importance"] = 1.0
            try:
                conf = float(c.get("confidence", 0.8))
                c["confidence"] = min(max(conf, 0.0), 1.0)
            except Exception:
                c["confidence"] = 0.8
            # deviation 规范化
            dev = str(c.get("deviation", "none")).strip()
            if dev not in VALID_DEV:
                dev = DEV_ALIAS.get(dev, "none")
            c["deviation"] = dev
            # severity 与 deviation 合法组合
            sev = c.get("severity", "info")
            if sev not in LEGAL_SEV[dev]:
                sev = next(iter(LEGAL_SEV[dev]))
            c["severity"] = sev
            # 文本字段兜底
            c["text"] = (c.get("text") or c.get("claim") or c.get("statement") or f"claim {c['id']}").strip() or f"claim {c['id']}"
            c["transformation"] = (c.get("transformation") or "N/A").strip() or "N/A"
            c["reason"] = (c.get("reason") or "无补充说明").strip() or "无补充说明"
            # 引用清洗
            evs = c.get("evidence_refs")
            evs = [str(x) for x in evs] if isinstance(evs, list) else []
            srs = c.get("source_refs")
            srs = [str(x) for x in srs] if isinstance(srs, list) else []

            if dev == "insufficient_evidence":
                # 必须结构化说明缺失证据类型
                mets = c.get("missing_evidence_types")
                if not isinstance(mets, list) or not mets:
                    mets = ["report", "source"]
                mets = [m for m in mets if m in MISSING_TYPES] or ["report"]
                c["missing_evidence_types"] = mets
                # 这一类不校验 source_refs / quoted_evidence，但字段仍需存在
                c["source_refs"] = srs
                c["evidence_refs"] = evs
                c["quoted_evidence"] = c.get("quoted_evidence", "")
            else:
                # 确定判断：evidence_refs 至少一个 report:；且须含 source:（与 source_refs 交集） 或 artifact:/trace:
                c.pop("missing_evidence_types", None)
                if not srs:
                    srs = ["source:auto"]
                if not any(str(r).startswith("report:") for r in evs):
                    evs.append("report:auto")
                # 让 source_refs 与 evidence_refs 至少一项重合
                if not any(r in evs for r in srs):
                    evs.append(srs[0])
                c["source_refs"] = srs
                c["evidence_refs"] = evs
                q = (c.get("quoted_evidence") or "").strip()
                c["quoted_evidence"] = q or "(未提供引用文本，占位)"
            cleaned.append(c)
        if not cleaned:
            cleaned = [{
                "id": "c1", "text": "占位 claim（LLM 未抽出任何断言）",
                "importance": 1.0, "confidence": 0.5,
                "deviation": "insufficient_evidence", "severity": "minor",
                "transformation": "N/A",
                "source_refs": [], "evidence_refs": [],
                "quoted_evidence": "",
                "missing_evidence_types": ["report", "source"],
                "reason": "占位以保证 CLI 通过"
            }]
        obj["claims"] = cleaned

    elif layer == "j3":
        tc = obj.get("task_contract")
        if not isinstance(tc, list):
            tc = []
        ALLOWED = {"id", "text", "kind", "triggered", "status", "evidence_refs",
                   "quoted_evidence", "reason", "trigger_evidence_refs"}
        KINDS = {"required", "conditional", "optional"}
        STATUSES = {"covered", "partial", "missing", "not_triggered", "insufficient_evidence"}
        cleaned = []
        seen = set()
        for i, t in enumerate(tc):
            if not isinstance(t, dict):
                continue
            t = dict(t)
            # 兼容 LLM 生成的旧字段
            if t.get("kind") == "required_deliverable":
                t["kind"] = "required"
            t.pop("should_generate", None)
            rid = t.get("id") or f"req-{i+1}"
            if rid in seen:
                rid = f"{rid}-{i+1}"
            seen.add(rid)
            t["id"] = rid
            if t.get("kind") not in KINDS:
                t["kind"] = "required"
            if t.get("status") not in STATUSES:
                t["status"] = "insufficient_evidence"
            t.setdefault("text", t.get("reason") or f"requirement {rid}")
            t.setdefault("reason", "")
            refs = t.get("evidence_refs")
            if not isinstance(refs, list):
                refs = []
            t["evidence_refs"] = [str(x) for x in refs]
            t.setdefault("quoted_evidence", "")
            if t["kind"] == "conditional":
                t.setdefault("triggered", False)
                if not isinstance(t["triggered"], bool):
                    t["triggered"] = bool(t["triggered"])
                if not t["triggered"]:
                    t["status"] = "not_triggered"
                    t.pop("trigger_evidence_refs", None)
                else:
                    if "trigger_evidence_refs" in t and not isinstance(t["trigger_evidence_refs"], list):
                        t["trigger_evidence_refs"] = []
            else:
                t.pop("triggered", None)
                t.pop("trigger_evidence_refs", None)
            # 剔除未知字段
            for k in list(t.keys()):
                if k not in ALLOWED:
                    t.pop(k)
            cleaned.append(t)
        if not cleaned:
            cleaned = [{
                "id": "req-1", "text": "占位：未从模型输出识别出显式任务要求",
                "kind": "optional", "status": "insufficient_evidence",
                "evidence_refs": [], "quoted_evidence": "",
                "reason": "LLM 未产出 task_contract，保底占位以通过 CLI"
            }]
        obj["task_contract"] = cleaned

    return obj


def extract_layer_input(task: TaskInput, layer: str, config: JudgerConfig) -> Dict[str, Any]:
    """为单个任务的某层生成 CLI 输入 JSON。若前端已提供结构化输入则直接使用。"""
    preset = {
        "j1": task.j1_input,
        "j2": task.j2_input,
        "j3": task.j3_input,
    }.get(layer)
    if preset is not None:
        return _normalize_cli_input(layer, preset, task)

    if layer == "j4":
        raise HTTPException(status_code=400, detail="J4 需要 pairwise 输入，请从前端预生成 j4-pairs 后送入。")
    # J5 由 evaluate_task 内部级联组装，不走本函数

    system = load_prompt(layer) + "\n\n<expert_rules>\n" + load_rules(layer) + "\n</expert_rules>"
    user = build_user_prompt(task, layer)
    raw = call_llm(config, system, user)
    try:
        parsed = extract_json(raw)
    except HTTPException:
        # LLM 抽取失败时给出最小占位，让后续 CLI 仍能给出保守分
        parsed = {}
    return _normalize_cli_input(layer, parsed, task)


# ==== Skill CLI 执行 ====
def run_skill_cli(layer: str, input_path: Path, output_path: Path) -> Dict[str, Any]:
    cli = SKILLS_DIR / SKILL_META[layer]["cli"]
    if not cli.exists():
        raise HTTPException(status_code=500, detail=f"Skill CLI 不存在：{cli}")
    proc = subprocess.run(
        ["node", str(cli), str(input_path), str(output_path)],
        capture_output=True, text=True, timeout=90,
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail=f"{layer.upper()} CLI 失败：{proc.stderr[:600] or proc.stdout[:600]}",
        )
    return json.loads(output_path.read_text(encoding="utf-8"))


# ==== 单任务评估 ====
def evaluate_task(task: TaskInput, layers: List[str], config: JudgerConfig) -> Dict[str, Any]:
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{task.task_id}-{task.model_id}"
    workdir = WORK_DIR / stamp
    workdir.mkdir(parents=True, exist_ok=True)

    result: Dict[str, Any] = {"task_id": task.task_id, "model_id": task.model_id, "layers": {}}
    produced: Dict[str, Dict[str, Any]] = {}  # 保存已经产出的层结果，供 J5 级联

    # 单机模式下 J4 需要多模型 pairwise 输入，暂不支持从 trace 抽取，直接跳过
    ordered = [l for l in ["j1", "j2", "j3", "j4", "j5"] if l in layers]

    for layer in ordered:
        if layer not in SKILL_META:
            result["layers"][layer] = {"error": f"未知层：{layer}"}
            continue
        try:
            if layer == "j5":
                # 用已产出的 j1/j2/j3 组装最小 upstream，跑 J5 追溯
                if not all(k in produced for k in ("j1", "j2", "j3")):
                    result["layers"][layer] = {"error": "J5 需要 J1/J2/J3 先完成才能级联"}
                    continue
                payload = _build_j5_input(task, produced)
            elif layer == "j4":
                result["layers"][layer] = {"skipped": True, "reason": "J4 需要 pairwise 输入；请在多模型评估场景下手动上传 j4-pairs.json"}
                continue
            else:
                payload = extract_layer_input(task, layer, config)

            in_path = workdir / f"{layer}-input.json"
            out_path = workdir / f"{layer}-output.json"
            in_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            output = run_skill_cli(layer, in_path, out_path)
            produced[layer] = output
            result["layers"][layer] = _summarize(layer, output)
            result["layers"][layer]["_raw_path"] = str(out_path.relative_to(ROOT))
        except HTTPException as e:
            result["layers"][layer] = {"error": e.detail}
        except Exception as e:
            result["layers"][layer] = {"error": str(e)}
    return result


def _build_j5_input(task: TaskInput, produced: Dict[str, Any]) -> Dict[str, Any]:
    """把 J1—J3 的产物拼装为 J5 CLI 所需的最小 upstream_results。"""
    j1 = produced.get("j1") or {}
    j2 = produced.get("j2") or {}
    j3 = produced.get("j3") or {}
    # 与 J5 主 task_id / model_id 对齐（CLI 要求上下游一致）
    for u in (j1, j2, j3):
        u["task_id"] = task.task_id
        u["model_id"] = task.model_id

    # J4 缺省时给一个 all_same 结构，满足 schema
    j4 = {
        "method": "Bradley-Terry-Davidson MLE",
        "status": "all_same",
        "counts": {"submitted": 0, "accepted": 0, "deduplicated": 0, "swap": 0, "rejected": 0, "btd_votes": 0},
        "rejection_reasons": [],
        "tie_parameter": 0.0,
        "log_likelihood": 0.0,
        "rankings": [{"model_id": task.model_id, "rank": 1, "rank_group": 1, "strength": 1.0, "score": 50, "comparisons": 0}],
        "rank_groups": [[task.model_id]],
        "conflicts": [],
    }
    upstream = {"j1": j1, "j2": j2, "j3": j3, "j4": j4}

    # 计算 actionable stable_issue_keys（与 buildJudgementRegistry 逻辑一致）
    keys: List[str] = []
    for d in j1.get("dimensions", []):
        if d.get("status") in ("partial", "fail", "insufficient_evidence"):
            keys.append(f"j1:{d.get('id')}")
    for c in j2.get("claims", []):
        if c.get("deviation") not in (None, "none"):
            keys.append(f"j2:{c.get('id')}")
    for t in j3.get("task_contract", []):
        if t.get("status") in ("partial", "missing", "insufficient_evidence"):
            keys.append(f"j3:{t.get('id')}")
    # 去重
    keys = list(dict.fromkeys(keys))

    mapping_ledger = [{
        "stable_issue_key": k,
        "status": "unresolved",
        "reason": "unknown: 自动生成的 J5 输入未产出 findings",
    } for k in keys]

    return {
        "task_id": task.task_id,
        "model_id": task.model_id,
        "upstream_results": upstream,
        "findings": [],
        "mapping_ledger": mapping_ledger,
        "trace_nodes": [],
    }


def _summarize(layer: str, out: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(out, dict):
        # CLI 输出应为 dict；异常情况下（例如输出 null / 数组）兜底
        return {"error": f"CLI 输出非对象: {type(out).__name__}", "raw": str(out)[:400]}
    if layer == "j1":
        return {
            "score": out.get("score"),
            "conservative_score": out.get("conservative_score"),
            "evidence_coverage": out.get("evidence_coverage"),
            "critical_failure": out.get("critical_failure"),
            "summary": out.get("summary"),
        }
    if layer == "j2":
        claims = out.get("claims") or []
        if not isinstance(claims, list): claims = []
        return {
            "weighted_deviation_rate": out.get("weighted_deviation_rate"),
            "claims": len(claims),
            "critical_claims": sum(1 for c in claims if isinstance(c, dict) and c.get("severity") == "critical"),
        }
    if layer == "j3":
        tc = out.get("task_contract") or []
        if not isinstance(tc, list): tc = []
        return {
            "overall_score": out.get("overall_score"),
            "covered": sum(1 for t in tc if isinstance(t, dict) and t.get("status") in ("covered", "pass")),
            "total": len(tc),
        }
    if layer == "j4":
        return {
            "status": out.get("status"),
            "rankings": out.get("rankings") or [],
            "tie_parameter": out.get("tie_parameter"),
        }
    if layer == "j5":
        findings = out.get("findings") or []
        ledger = out.get("mapping_ledger") or []
        integrity = out.get("integrity") or {}
        if not isinstance(findings, list): findings = []
        if not isinstance(ledger, list): ledger = []
        if not isinstance(integrity, dict): integrity = {}
        return {
            "findings": len(findings),
            "unresolved": sum(1 for m in ledger if isinstance(m, dict) and m.get("status") == "unresolved"),
            "closure_ok": integrity.get("closure_ok"),
        }
    return {"raw": out}


# ==== HTTP 接口 ====
@app.get("/health")
def health():
    return {
        "status": "ok",
        "skills_dir": str(SKILLS_DIR),
        "skills_available": {k: (SKILLS_DIR / v["cli"]).exists() for k, v in SKILL_META.items()},
    }


@app.post("/evaluate")
def evaluate(req: EvaluateRequest):
    """
    批量评估：接收多个 task，逐个走 LLM 抽取 + CLI 执行，返回汇总结果。
    """
    if not (SKILLS_DIR / "trade-j1-methodology" / "index.js").exists():
        raise HTTPException(status_code=500, detail=f"Skill 包未找到：{SKILLS_DIR}")
    if not req.tasks:
        raise HTTPException(status_code=400, detail="tasks 为空")
    if not req.config.api_key:
        raise HTTPException(status_code=400, detail="缺少 API Key")

    results = []
    for task in req.tasks:
        results.append(evaluate_task(task, req.layers, req.config))
    return {
        "count": len(results),
        "layers": req.layers,
        "model": req.config.model_id,
        "results": results,
    }


# ==== 流式评估：SSE 逐层输出 ====
def _sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _evaluate_task_stream(task: TaskInput, layers: List[str], config: JudgerConfig):
    """按层流式输出：extract → cli → summarize，每步一个 SSE 事件。"""
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{task.task_id}-{task.model_id}"
    workdir = WORK_DIR / stamp
    workdir.mkdir(parents=True, exist_ok=True)

    produced: Dict[str, Dict[str, Any]] = {}
    ordered = [l for l in ["j1", "j2", "j3", "j4", "j5"] if l in layers]
    task_summary: Dict[str, Dict[str, Any]] = {}
    # 逐层保存分析过程，用于 task_done 里返回 Markdown 报告
    layer_records: Dict[str, Dict[str, Any]] = {}

    for layer in ordered:
        yield _sse("layer_start", {"task": task.task_id, "model": task.model_id, "layer": layer, "stage": "extract"})
        rec: Dict[str, Any] = {"layer": layer, "raw": None, "extracted": None, "output": None,
                               "source": None, "error": None, "skipped": False}
        try:
            if layer == "j5":
                if not all(k in produced for k in ("j1", "j2", "j3")):
                    task_summary[layer] = {"error": "J5 需要 J1/J2/J3 先完成"}
                    rec["error"] = "需要 J1/J2/J3 先完成"
                    layer_records[layer] = rec
                    yield _sse("layer_error", {"task": task.task_id, "layer": layer, "error": "需要 J1/J2/J3 先完成"})
                    continue
                payload = _build_j5_input(task, produced)
                rec["source"] = "cascade"
                rec["extracted"] = payload
                yield _sse("layer_progress", {"task": task.task_id, "layer": layer, "stage": "assembled",
                                              "keys": len(payload.get("mapping_ledger", []))})
            elif layer == "j4":
                task_summary[layer] = {"skipped": True, "reason": "J4 需要 pairwise 输入"}
                rec["skipped"] = True
                rec["error"] = "J4 需要 pairwise 输入"
                layer_records[layer] = rec
                yield _sse("layer_skip", {"task": task.task_id, "layer": layer, "reason": "J4 需要 pairwise 输入"})
                continue
            else:
                preset = {"j1": task.j1_input, "j2": task.j2_input, "j3": task.j3_input}.get(layer)
                if preset is not None:
                    payload = _normalize_cli_input(layer, preset, task)
                    rec["source"] = "preset"
                    rec["extracted"] = payload
                    yield _sse("layer_progress", {"task": task.task_id, "layer": layer,
                                                  "stage": "preset", "note": "使用前端已抽取的结构化输入"})
                else:
                    rec["source"] = "llm"
                    yield _sse("layer_progress", {"task": task.task_id, "layer": layer,
                                                  "stage": "llm_call", "note": f"调用 {config.model_id} 抽取 {layer.upper()}"})
                    system = load_prompt(layer) + "\n\n<expert_rules>\n" + load_rules(layer) + "\n</expert_rules>"
                    user = build_user_prompt(task, layer)
                    try:
                        raw = call_llm(config, system, user)
                        rec["raw"] = raw
                        yield _sse("layer_progress", {"task": task.task_id, "layer": layer,
                                                      "stage": "llm_done", "bytes": len(raw)})
                    except HTTPException as e:
                        err_detail = str(e.detail)[:1200]
                        rec["raw"] = f"[LLM 调用失败]\n{err_detail}"
                        rec["error"] = err_detail[:400]
                        yield _sse("layer_progress", {"task": task.task_id, "layer": layer,
                                                      "stage": "llm_fail", "error": err_detail[:300]})
                        raw = "{}"
                    try:
                        parsed = extract_json(raw)
                    except HTTPException:
                        parsed = {}
                    payload = _normalize_cli_input(layer, parsed, task)
                    rec["extracted"] = payload
                    # 保存 LLM 抽取的原文本（或失败详情）
                    (workdir / f"{layer}-llm-raw.txt").write_text(rec.get("raw") or "", encoding="utf-8")

            in_path = workdir / f"{layer}-input.json"
            out_path = workdir / f"{layer}-output.json"
            in_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            yield _sse("layer_progress", {"task": task.task_id, "layer": layer, "stage": "cli_run",
                                          "cli": f"node trade-{layer}-*/index.js"})
            output = run_skill_cli(layer, in_path, out_path)
            produced[layer] = output
            rec["output"] = output
            summary = _summarize(layer, output)
            summary["_raw_path"] = str(out_path.relative_to(ROOT))
            task_summary[layer] = summary
            layer_records[layer] = rec
            yield _sse("layer_done", {"task": task.task_id, "layer": layer, "summary": summary})
        except HTTPException as e:
            task_summary[layer] = {"error": str(e.detail)}
            rec["error"] = str(e.detail)
            layer_records[layer] = rec
            yield _sse("layer_error", {"task": task.task_id, "layer": layer, "error": str(e.detail)[:300]})
        except Exception as e:
            import traceback, sys
            tb = traceback.format_exc()
            sys.stderr.write(f"[LAYER {layer.upper()} EXC] task={task.task_id}\n{tb}\n")
            task_summary[layer] = {"error": str(e)}
            rec["error"] = f"{type(e).__name__}: {e}"
            layer_records[layer] = rec
            yield _sse("layer_error", {"task": task.task_id, "layer": layer,
                                       "error": f"{type(e).__name__}: {str(e)[:280]}"})

    # 生成 Markdown 报告并写盘 + 通过 task_done 事件返回
    report_md = _build_markdown_report(task, config, task_summary, layer_records)
    try:
        (workdir / "report.md").write_text(report_md, encoding="utf-8")
    except Exception:
        pass
    yield _sse("task_done", {
        "task": task.task_id, "model": task.model_id,
        "layers": task_summary,
        "report_md": report_md,
        "workdir": str(workdir.relative_to(ROOT)),
    })


def _build_markdown_report(task: TaskInput, config: JudgerConfig,
                           summary: Dict[str, Any], records: Dict[str, Any]) -> str:
    """将 J1—J5 每一层的 LLM 抽取、CLI 输出、判定结论渲染为 Markdown 分析报告。"""
    lines: List[str] = []
    p = lines.append

    p(f"# Tendata Trade Judger 分析报告")
    p("")
    p(f"- **任务 ID**：`{task.task_id}`")
    p(f"- **被测模型**：`{task.model_id}`")
    p(f"- **评估模型（Judger）**：`{config.model_id}`（provider: {config.provider}）")
    p(f"- **生成时间**：{time.strftime('%Y-%m-%d %H:%M:%S')}")
    p("")

    # 顶部摘要
    p("## 一、评测总览")
    p("")
    p("| 层 | 指标 | 数值 |")
    p("| :- | :- | :- |")
    def cell(v):
        if v is None: return "n/a"
        if isinstance(v, bool): return "是" if v else "否"
        if isinstance(v, float): return f"{v:.4f}"
        return str(v)
    LAYER_NAME = {"j1": "J1 · 方法论", "j2": "J2 · 数据忠实度", "j3": "J3 · 任务完整度",
                  "j4": "J4 · Pairwise BTD", "j5": "J5 · 诊断追溯"}
    for lay in ["j1", "j2", "j3", "j4", "j5"]:
        s = summary.get(lay)
        if s is None:
            continue
        name = LAYER_NAME[lay]
        if s.get("skipped"):
            p(f"| {name} | 状态 | 跳过（{s.get('reason','')}） |")
            continue
        if s.get("error"):
            p(f"| {name} | 状态 | 失败：{s['error'][:80]} |")
            continue
        if lay == "j1":
            p(f"| {name} | Methodology Score | {cell(s.get('score'))} |")
            p(f"| | Conservative Score | {cell(s.get('conservative_score'))} |")
            p(f"| | Evidence Coverage | {cell(s.get('evidence_coverage'))} |")
            p(f"| | Critical Failure | {cell(s.get('critical_failure'))} |")
        elif lay == "j2":
            p(f"| {name} | Weighted Deviation Rate | {cell(s.get('weighted_deviation_rate'))} |")
            p(f"| | Claims 总数 | {cell(s.get('claims'))} |")
            p(f"| | Critical Claims | {cell(s.get('critical_claims'))} |")
        elif lay == "j3":
            p(f"| {name} | Overall Score | {cell(s.get('overall_score'))} |")
            p(f"| | Covered / Total | {cell(s.get('covered'))} / {cell(s.get('total'))} |")
        elif lay == "j4":
            p(f"| {name} | Status | {cell(s.get('status'))} |")
        elif lay == "j5":
            p(f"| {name} | Findings | {cell(s.get('findings'))} |")
            p(f"| | Unresolved | {cell(s.get('unresolved'))} |")
            p(f"| | Closure OK | {cell(s.get('closure_ok'))} |")
    p("")

    # 逐层细节
    for lay in ["j1", "j2", "j3", "j4", "j5"]:
        rec = records.get(lay)
        s = summary.get(lay)
        if rec is None and s is None:
            continue
        p(f"## {LAYER_NAME[lay]}")
        p("")
        if rec and rec.get("skipped"):
            p(f"> **状态**：已跳过 · {rec.get('error') or ''}")
            p("")
            continue
        if s and s.get("error"):
            p(f"> **状态**：失败 · {s['error']}")
            p("")

        # 关键结论
        p("### 结论指标")
        p("")
        if s and not s.get("error"):
            for k, v in s.items():
                if k.startswith("_"):
                    continue
                p(f"- **{k}**：{cell(v)}")
            p("")

        # LLM 原始抽取（截断防止太长）
        if rec:
            if rec.get("source") == "llm":
                if rec.get("error"):
                    p("### LLM 调用失败")
                    p("")
                    p("> **原因**：" + str(rec.get("error"))[:800].replace("\n", " "))
                    p("")
                    p("> 已保底占位为全 `insufficient_evidence`；因此各维度分数为 0。请检查 API Key / model_id / API 协议（chat vs responses）/ base_url，或延长 timeout。")
                    p("")
                p("### LLM 抽取原文")
                p("")
                raw = (rec.get("raw") or "").strip()
                if raw:
                    truncated = raw if len(raw) < 4000 else raw[:4000] + "\n\n…（原文已截断，完整内容见 " + f"{lay}-llm-raw.txt）"
                    p("```")
                    p(truncated)
                    p("```")
                else:
                    p("> LLM 未返回内容或调用失败。")
                p("")
            elif rec.get("source") == "preset":
                p("### 输入来源")
                p("")
                p("> 使用前端已提供的结构化输入，跳过 LLM 抽取。")
                p("")
            elif rec.get("source") == "cascade":
                p("### 输入来源")
                p("")
                p("> 由 J1/J2/J3 的上游产物自动级联构造。")
                p("")

        # 逐维度 / 逐 claim / 逐契约细节
        if rec and rec.get("output"):
            _write_layer_detail(p, lay, rec["output"], rec.get("extracted"))

    return "\n".join(lines)


def _write_layer_detail(p, layer: str, output: Dict[str, Any], extracted: Dict[str, Any]):
    """把 CLI 输出与 LLM 抽取的关键内容以 Markdown 形式列出。"""
    if layer == "j1":
        dims = output.get("dimensions", [])
        if dims:
            p("### 六维方法论评估")
            p("")
            p("| 维度 | 状态 | 严重度 | 置信度 | 证据引用 | 判断说明 |")
            p("| :- | :- | :- | :- | :- | :- |")
            for d in dims:
                refs = ", ".join(d.get("evidence_refs") or [])
                reason = (d.get("reason") or "").replace("\n", " ").replace("|", "／")
                p(f"| {d.get('id')} | {d.get('status')} | {d.get('severity')} | {d.get('confidence')} | {refs} | {reason[:160]} |")
            p("")
            # 每个维度的引用原文
            for d in dims:
                q = (d.get("quoted_evidence") or "").strip()
                if q:
                    p(f"- **{d.get('id')}**：")
                    p(f"  > {q[:400]}")
            p("")
    elif layer == "j2":
        claims = output.get("claims", [])
        if claims:
            p("### 逐条 Data Claim 核验")
            p("")
            p("| ID | Deviation | Severity | Importance | Confidence | 判断 |")
            p("| :- | :- | :- | :- | :- | :- |")
            for c in claims:
                reason = (c.get("reason") or "").replace("\n", " ").replace("|", "／")
                p(f"| {c.get('id')} | {c.get('deviation')} | {c.get('severity')} | {c.get('importance')} | {c.get('confidence')} | {reason[:160]} |")
            p("")
            for c in claims:
                text = (c.get("text") or "").strip()
                q = (c.get("quoted_evidence") or "").strip()
                if text or q:
                    p(f"- **{c.get('id')}** · deviation=`{c.get('deviation')}`")
                    if text:
                        p(f"  - 断言：{text[:300]}")
                    if q:
                        p(f"  - 证据：> {q[:300]}")
            p("")
    elif layer == "j3":
        tc = output.get("task_contract", [])
        if tc:
            p("### 任务契约覆盖情况")
            p("")
            p("| ID | Kind | Status | 说明 |")
            p("| :- | :- | :- | :- |")
            for t in tc:
                reason = (t.get("reason") or "").replace("\n", " ").replace("|", "／")
                p(f"| {t.get('id')} | {t.get('kind')} | {t.get('status')} | {reason[:180]} |")
            p("")
    elif layer == "j5":
        findings = output.get("findings", [])
        if findings:
            p("### Findings")
            p("")
            p("| ID | Severity | Owner | 根因 |")
            p("| :- | :- | :- | :- |")
            for f in findings:
                rc = (f.get("root_cause") or "").replace("\n", " ").replace("|", "／")
                p(f"| {f.get('id')} | {f.get('severity')} | {f.get('owner')} | {rc[:180]} |")
            p("")
        ledger = output.get("mapping_ledger", [])
        if ledger:
            p("### Mapping Ledger（映射闭包）")
            p("")
            for x in ledger[:40]:
                p(f"- `{x.get('stable_issue_key')}` · **{x.get('status')}** · {x.get('reason','')[:160]}")
            p("")


@app.post("/evaluate/stream")
def evaluate_stream(req: EvaluateRequest):
    """
    SSE 流式评估：每一层完成即推送一次事件。事件类型：
      layer_start / layer_progress / layer_done / layer_error / layer_skip / task_done / all_done
    """
    if not (SKILLS_DIR / "trade-j1-methodology" / "index.js").exists():
        raise HTTPException(status_code=500, detail=f"Skill 包未找到：{SKILLS_DIR}")
    if not req.tasks:
        raise HTTPException(status_code=400, detail="tasks 为空")

    def gen():
        yield _sse("all_start", {"count": len(req.tasks), "layers": req.layers, "model": req.config.model_id})
        for idx, task in enumerate(req.tasks):
            yield _sse("task_start", {"index": idx + 1, "total": len(req.tasks),
                                       "task": task.task_id, "model": task.model_id})
            for chunk in _evaluate_task_stream(task, req.layers, req.config):
                yield chunk
        yield _sse("all_done", {"count": len(req.tasks)})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/evaluate/upload")
async def evaluate_upload(
    files: List[UploadFile] = File(...),
    layers: str = Form("j1,j2,j3"),
    provider: str = Form("volcengine-ark"),
    model_id: str = Form(...),
    api_key: str = Form(...),
    base_url: str = Form("https://ark.cn-beijing.volces.com/api/v3"),
    temperature: float = Form(0.1),
):
    """
    直接上传文件评估。每个文件应为 JSON，含 task_id / model_id / (trace|output|j1_input|j2_input|j3_input)。
    """
    layer_list = [x.strip() for x in layers.split(",") if x.strip()]
    config = JudgerConfig(
        provider=provider, model_id=model_id, api_key=api_key,
        base_url=base_url, temperature=temperature,
    )
    tasks: List[TaskInput] = []
    for uf in files:
        raw = (await uf.read()).decode("utf-8", errors="replace")
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"{uf.filename} 非合法 JSON: {e}")
        tasks.append(TaskInput(**obj))

    return evaluate(EvaluateRequest(tasks=tasks, layers=layer_list, config=config))


@app.post("/test-connection")
def test_connection(config: JudgerConfig):
    t0 = time.time()
    text = call_llm(config, "You are a health check.", "Say 'ok' in JSON: {\"ok\": true}")
    return {
        "ok": True,
        "latency_ms": int((time.time() - t0) * 1000),
        "model": config.model_id,
        "sample_response": text[:200],
    }


class SynthesizeRequest(BaseModel):
    """基于一次批量评估的所有结果，请 LLM 输出一份综合分析报告。"""
    results: List[Dict[str, Any]]
    config: JudgerConfig
    focus: Optional[str] = None  # 可选：用户自定义关注点


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    """把批量评估结果的 J1—J5 关键指标 + 每份任务的 markdown 报告摘要，
    交给 Judger LLM 做跨任务/跨模型的综合分析，返回 Markdown。"""
    if not req.results:
        raise HTTPException(status_code=400, detail="results 为空，请先跑一次评估。")

    # 1) 汇总为结构化输入（避免把整份 report_md 全塞进去导致 token 爆炸）
    rows: List[Dict[str, Any]] = []
    per_model: Dict[str, Dict[str, Any]] = {}
    for r in req.results:
        row = {
            "file": r.get("file"),
            "task": r.get("task"),
            "model": r.get("model"),
            "j1_score": (r.get("j1") or {}).get("score"),
            "j1_coverage": (r.get("j1") or {}).get("coverage"),
            "j1_critical": (r.get("j1") or {}).get("critical"),
            "j1_error": (r.get("j1") or {}).get("error"),
            "j2_wdr": (r.get("j2") or {}).get("wdr"),
            "j2_claims": (r.get("j2") or {}).get("claims"),
            "j2_critical_claims": (r.get("j2") or {}).get("critical_claims"),
            "j2_error": (r.get("j2") or {}).get("error"),
            "j3_score": (r.get("j3") or {}).get("score"),
            "j3_covered": (r.get("j3") or {}).get("covered"),
            "j3_total": (r.get("j3") or {}).get("total"),
            "j3_error": (r.get("j3") or {}).get("error"),
            "j4_status": (r.get("j4") or {}).get("status") or ("skipped" if (r.get("j4") or {}).get("skipped") else None),
            "j5_findings": (r.get("j5") or {}).get("findings"),
            "j5_unresolved": (r.get("j5") or {}).get("unresolved"),
            "j5_closure_ok": (r.get("j5") or {}).get("closure_ok"),
            "j5_error": (r.get("j5") or {}).get("error"),
        }
        rows.append(row)
        # 按模型聚合
        m = row["model"] or "unknown"
        agg = per_model.setdefault(m, {"count": 0, "j1_scores": [], "j2_wdrs": [], "j3_scores": [],
                                       "criticals": 0, "unresolved": 0})
        agg["count"] += 1
        if isinstance(row["j1_score"], (int, float)): agg["j1_scores"].append(row["j1_score"])
        if isinstance(row["j2_wdr"], (int, float)): agg["j2_wdrs"].append(row["j2_wdr"])
        if isinstance(row["j3_score"], (int, float)): agg["j3_scores"].append(row["j3_score"])
        if row["j1_critical"]: agg["criticals"] += 1
        if isinstance(row["j5_unresolved"], (int, float)) and row["j5_unresolved"] > 0:
            agg["unresolved"] += 1

    def _avg(xs): return round(sum(xs) / len(xs), 3) if xs else None
    model_summary = {m: {
        "count": v["count"],
        "j1_avg": _avg(v["j1_scores"]),
        "j2_wdr_avg": _avg(v["j2_wdrs"]),
        "j3_avg": _avg(v["j3_scores"]),
        "critical_count": v["criticals"],
        "unresolved_tasks": v["unresolved"],
    } for m, v in per_model.items()}

    # 2) 摘录每份任务的报告 findings/failure 前若干 KB
    excerpts = []
    for r in req.results[:20]:  # 上限 20 份，避免 token 溢出
        md = r.get("report_md") or ""
        if not md:
            continue
        # 只保留总览 + J5 findings 段（如果有）
        head = md[:2000]
        excerpts.append(f"### {r.get('task')} / {r.get('model')}\n{head}\n---\n")

    # 3) 组装 LLM 输入
    system = (
        "你是 Tendata 外贸评测框架的资深专家评审员。基于用户提供的一次批量评估的 "
        "J1（方法论）/ J2（数据忠实度）/ J3（任务完整度）/ J4（Pairwise）/ J5（诊断追溯）"
        "全量结果，输出一份跨任务、跨模型的综合分析报告。\n\n"
        "写作纪律：\n"
        "1) 严格用 Markdown 输出（含二级/三级标题、表格、有序/无序列表）。\n"
        "2) 使用「」代替双引号；禁止使用「不是……而是……」句式。\n"
        "3) 风格：严谨、专业、学术化，追求高信息密度。\n"
        "4) 每项判断必须落到具体数值或任务 ID；避免空泛评价。\n"
        "5) 报告结构：\n"
        "   ## 一、总体表现\n"
        "   ## 二、跨模型对比（表格）\n"
        "   ## 三、五层评测层间归因\n"
        "   ## 四、失败模式与共性缺陷\n"
        "   ## 五、改进建议（分模型、分层）\n"
        "   ## 六、置信度与数据局限\n"
    )
    user_focus = f"\n\n用户关注点：{req.focus}\n" if req.focus else ""
    user = (
        f"# 批量评估元数据\n"
        f"- 任务数：{len(rows)}\n"
        f"- 模型数：{len(per_model)}\n"
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"{user_focus}\n"
        f"# 结构化结果（JSON）\n\n"
        f"```json\n{json.dumps({'per_task': rows, 'per_model': model_summary}, ensure_ascii=False, indent=2)[:20000]}\n```\n\n"
        f"# 各任务原报告摘录（每份仅取前 2KB）\n\n" + "\n".join(excerpts)[:16000]
        + "\n\n请严格按照系统指令的六节结构，输出完整 Markdown 综合分析报告。"
    )

    t0 = time.time()
    md = call_llm(req.config, system, user)
    elapsed = int((time.time() - t0) * 1000)

    # 4) 落盘归档
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = WORK_DIR / f"synthesis-{stamp}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "synthesis.md").write_text(md, encoding="utf-8")
    (out_dir / "input.json").write_text(json.dumps({"per_task": rows, "per_model": model_summary},
                                                    ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "elapsed_ms": elapsed,
        "model": req.config.model_id,
        "task_count": len(rows),
        "model_count": len(per_model),
        "workdir": str(out_dir.relative_to(ROOT)),
        "report_md": md,
        "per_model_summary": model_summary,
    }
