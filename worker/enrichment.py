"""LLM enrichment: classify severity + generate explanation using similar past incidents."""
import json
import os
from pydantic import BaseModel, Field
from typing import Literal
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential


CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-2.5-flash")

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("GEMINI_API_KEY"),
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
    return _client


class Enrichment(BaseModel):
    """Structured output from the LLM for an anomalous log."""
    severity: Literal["low", "med", "high", "critical"] = Field(
        description="How urgent is this incident?"
    )
    category: str = Field(
        description="A short tag, e.g. 'auth_failure', 'disk_full', 'network_timeout'."
    )
    explanation: str = Field(
        description="One or two sentences in plain English describing what likely happened."
    )
    recommended_action: str = Field(
        description="A concrete next step a human operator should take."
    )


SYSTEM_PROMPT = """You are an SRE assistant analyzing log lines from production systems.
Given a single log line flagged as anomalous, classify it and explain it concisely.
You may be shown similar past incidents for context — use them to inform your answer.
Be direct. Avoid speculation beyond what the logs support.

You MUST respond with a JSON object containing EXACTLY these four fields and no others:
{
  "severity": "low" | "med" | "high" | "critical",
  "category": "<short snake_case tag, e.g. auth_failure, disk_full, network_timeout>",
  "explanation": "<one or two sentences in plain English>",
  "recommended_action": "<a concrete next step a human operator should take>"
}

Do not include any other fields. Do not wrap the JSON in markdown."""


def _build_user_prompt(raw_log: str, similar: list[dict]) -> str:
    parts = [f"Anomalous log line:\n{raw_log}\n"]
    if similar:
        parts.append("\nSimilar past incidents:")
        for i, s in enumerate(similar, 1):
            sev = s.get("severity") or "unknown"
            exp = s.get("explanation") or "(no explanation)"
            parts.append(f"{i}. [{sev}] {s['raw_log'][:120]} — {exp}")
    return "\n".join(parts)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
)
def enrich(raw_log: str, similar: list[dict] | None = None) -> Enrichment:
    """Call the LLM to enrich an anomalous incident."""
    similar = similar or []
    response = get_client().chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(raw_log, similar)},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    payload = json.loads(response.choices[0].message.content)

    # Defensive normalization: Gemini sometimes returns alternate keys.
    key_aliases = {
        "classification": "category",
        "class": "category",
        "type": "category",
        "level": "severity",
        "urgency": "severity",
        "description": "explanation",
        "action": "recommended_action",
        "next_step": "recommended_action",
        "next_action": "recommended_action",
    }
    for alt, canonical in key_aliases.items():
        if alt in payload and canonical not in payload:
            payload[canonical] = payload.pop(alt)

    # Backfill anything still missing.
    payload.setdefault("severity", "low")
    payload.setdefault("category", "unknown")
    payload.setdefault("explanation", "(no explanation provided)")
    payload.setdefault("recommended_action", "review the log manually")

    # Normalize severity casing/variants.
    if isinstance(payload.get("severity"), str):
        sev = payload["severity"].lower().strip()
        sev_map = {"medium": "med", "moderate": "med", "warning": "med", "info": "low"}
        payload["severity"] = sev_map.get(sev, sev)

    return Enrichment(**payload)