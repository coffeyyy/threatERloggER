"""RAG over the incidents table using LangChain + Gemini + pgvector."""
import os
from typing import TypedDict

import psycopg2
from psycopg2.extras import RealDictCursor
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser


# Reuse the same models we use in the worker.
EMBED_MODEL = "models/gemini-embedding-001"
CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-2.5-flash")


class IncidentRef(TypedDict):
    id: int
    severity: str | None
    raw_log: str
    explanation: str | None


class ChatAnswer(TypedDict):
    answer: str
    sources: list[IncidentRef]


def _get_embedder() -> GoogleGenerativeAIEmbeddings:
    return GoogleGenerativeAIEmbeddings(
        model=EMBED_MODEL,
        task_type="retrieval_query",
        output_dimensionality=1536,
    )


def _get_llm() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=CHAT_MODEL,
        temperature=0.2,
    )


def _retrieve_similar(embedding: list[float], k: int = 5) -> list[IncidentRef]:
    """Pull the top-k most similar incidents by embedding distance."""
    db_url = os.getenv("DATABASE_URL")
    with psycopg2.connect(db_url) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, raw_log, source, severity, explanation
                FROM incidents
                WHERE embedding IS NOT NULL
                ORDER BY embedding <-> %s::vector
                LIMIT %s
                """,
                (str(embedding), k),
            )
            return [
                {
                    "id": row["id"],
                    "severity": row["severity"],
                    "raw_log": row["raw_log"],
                    "explanation": row["explanation"],
                }
                for row in cur.fetchall()
            ]


_SYSTEM_PROMPT = """You are an SRE assistant answering questions about a production log stream.
You will be given a user question and a small set of relevant log incidents retrieved from the database.
Use those incidents to answer the question. Be direct and concrete.

If the incidents don't contain enough information to answer, say so plainly — do not invent facts.
When referring to incidents, you may cite them by id (e.g. "incident #47").
"""

_USER_PROMPT = """Question:
{question}

Relevant incidents (most relevant first):
{context}

Answer the question using only the incidents above."""


def _format_context(incidents: list[IncidentRef]) -> str:
    lines = []
    for inc in incidents:
        sev = inc["severity"] or "unknown"
        exp = inc["explanation"] or "(no AI explanation)"
        lines.append(
            f"#{inc['id']} [{sev}] {inc['raw_log']}\n    explanation: {exp}"
        )
    return "\n\n".join(lines) if lines else "(no matching incidents found)"


def answer_question(question: str, k: int = 5) -> ChatAnswer:
    """Run the full RAG pipeline for a single question."""
    embedder = _get_embedder()
    query_vec = embedder.embed_query(question)

    sources = _retrieve_similar(query_vec, k=k)
    context = _format_context(sources)

    prompt = ChatPromptTemplate.from_messages([
        ("system", _SYSTEM_PROMPT),
        ("user", _USER_PROMPT),
    ])
    chain = prompt | _get_llm() | StrOutputParser()
    answer = chain.invoke({"question": question, "context": context})

    return {"answer": answer, "sources": sources}