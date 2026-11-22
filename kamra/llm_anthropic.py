# Copyright (c) 2026, CloudTrade Centralised Systems Limited
# For license information, please see license.txt

"""Native Claude (Anthropic Messages API) transport for Kamra Agent.

The agent loop in kamra.assistant speaks OpenAI Chat Completions shapes.
When the property's base URL is api.anthropic.com, assistant._post_chat
hands the same body here instead: we translate it to a Messages API call
with the official SDK and return an object that looks like the requests
response the loop already reads (status_code / text / json() /
iter_lines()). Tools, guardrails and the action log are unchanged.

Claude's own content blocks (thinking, tool_use, fallback markers) ride on
the returned assistant message under "_anthropic_content" and are sent back
verbatim on the next round, as the API expects within a tool loop.
"""

from __future__ import annotations

import json

DEFAULT_MODEL = "claude-opus-5-5"
BASE_URL = "https://api.anthropic.com"
BETAS = ["server-side-fallback-2026-07-01"]


def is_anthropic(base: str | None) -> bool:
	return "anthropic.com" in (base or "").lower()


def model_for(model: str | None) -> str:
	m = (model or "").strip()
	return m if m.lower().startswith("claude") else DEFAULT_MODEL


class _Resp:
	"""Just enough of requests.Response for assistant.py."""

	def __init__(self, status_code: int, payload: dict | None = None, text: str = "", lines=None):
		self.status_code = status_code
		self._payload = payload
		self.text = text or (json.dumps(payload) if payload is not None else "")
		self._lines = lines

	def json(self):
		return self._payload

	def iter_lines(self):
		yield from (self._lines or ())


def _key(headers: dict) -> str:
	auth = headers.get("Authorization") or ""
	return auth[7:] if auth.startswith("Bearer ") else auth


def _client(headers: dict):
	import anthropic
	return anthropic.Anthropic(api_key=_key(headers), timeout=90.0, max_retries=2)


def _text_blocks(content) -> list:
	if isinstance(content, list):  # OpenAI content parts
		content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
	content = (content or "").strip()
	return [{"type": "text", "text": content}] if content else []


def to_messages(convo: list) -> tuple[str, list, set]:
	"""OpenAI-style convo -> (system, messages, tool names used in history)."""
	system, out, used = [], [], set()

	def push(role, blocks):
		if not blocks:
			return
		if out and out[-1]["role"] == role:
			out[-1]["content"].extend(blocks)
		else:
			out.append({"role": role, "content": list(blocks)})

	for m in convo:
		role = m.get("role")
		if role == "system":
			system.append(m.get("content") or "")
		elif role == "user":
			push("user", _text_blocks(m.get("content")))
		elif role == "assistant":
			raw = m.get("_anthropic_content")
			if raw:
				used.update(b.get("name") for b in raw if b.get("type") == "tool_use")
				push("assistant", raw)
				continue
			blocks = _text_blocks(m.get("content"))
			for c in m.get("tool_calls") or []:
				try:
					args = json.loads(c["function"].get("arguments") or "{}")
				except ValueError:
					args = {}
				used.add(c["function"]["name"])
				blocks.append({"type": "tool_use", "id": c["id"], "name": c["function"]["name"], "input": args})
			push("assistant", blocks)
		elif role == "tool":
			push("user", [{"type": "tool_result", "tool_use_id": m.get("tool_call_id"),
			               "content": str(m.get("content") or "")}])
	if out and out[0]["role"] != "user":
		out.insert(0, {"role": "user", "content": [{"type": "text", "text": "(conversation continues)"}]})
	return "\n\n".join(s for s in system if s), out, used


def _tools(body: dict, used: set) -> tuple[list, dict | None]:
	tools = [{"name": t["function"]["name"],
	          "description": t["function"].get("description") or "",
	          "input_schema": t["function"].get("parameters") or {"type": "object", "properties": {}}}
	         for t in body.get("tools") or []]
	if tools:
		return tools, None
	if used:  # history has tool calls: the API needs them defined; answer in text only
		return ([{"name": n, "description": n, "input_schema": {"type": "object", "properties": {}}}
		         for n in sorted(used)], {"type": "none"})
	return [], None


def _params(body: dict) -> dict:
	system, messages, used = to_messages(body.get("messages") or [])
	tools, choice = _tools(body, used)
	p = {
		"model": model_for(body.get("model")),
		"max_tokens": 16000,
		"betas": BETAS,
		"fallbacks": "default",
		"output_config": {"effort": "medium"},
		"messages": messages,
	}
	if system:
		p["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
	if tools:
		p["tools"] = tools
		if choice:
			p["tool_choice"] = choice
	return p


def _error(e) -> _Resp:
	import anthropic
	if isinstance(e, anthropic.APIStatusError):
		return _Resp(e.status_code, text=str(e.message)[:500])
	if isinstance(e, anthropic.APIConnectionError):
		return _Resp(503, text="Could not reach Claude (connection error).")
	return _Resp(500, text=str(e)[:300])


def post_chat(headers: dict, body: dict, *, stream: bool = False) -> _Resp:
	import anthropic
	params = _params(body)
	client = _client(headers)
	if stream:
		return _stream(client, params)
	try:
		resp = client.beta.messages.create(**params)
	except anthropic.APIError as e:
		return _error(e)
	blocks = [b.to_dict() for b in resp.content]
	text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
	if resp.stop_reason == "refusal":
		text = text or "I can't help with that request."
	calls = [{"id": b["id"], "type": "function",
	          "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}}
	         for b in blocks if b.get("type") == "tool_use"]
	msg = {"role": "assistant", "content": text, "_anthropic_content": blocks}
	if calls:
		msg["tool_calls"] = calls
	return _Resp(200, {"choices": [{"message": msg}]})


def _stream(client, params) -> _Resp:
	import anthropic
	try:
		cm = client.beta.messages.stream(**params)
		stream = cm.__enter__()
	except anthropic.APIError as e:
		return _error(e)

	def lines():
		try:
			for text in stream.text_stream:
				if text:
					yield ("data: " + json.dumps({"choices": [{"delta": {"content": text}}]})).encode()
		except anthropic.APIError as e:
			yield ("data: " + json.dumps({"choices": [{"delta": {"content": f"\n(Claude error: {str(e.message)[:120]})"}}]})).encode()
		finally:
			cm.__exit__(None, None, None)
		yield b"data: [DONE]"

	return _Resp(200, lines=lines())
