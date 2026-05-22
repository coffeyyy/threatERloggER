"""Database access for the worker. Thin wrapper around psycopg2."""
import os
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from contextlib import contextmanager
from typing import Iterator, Any


DB_URL = os.getenv("DATABASE_URL")


@contextmanager
def get_conn() -> Iterator[Any]:
    """Yield a psycopg2 connection. Auto-commits on clean exit, rolls back on error."""
    conn = psycopg2.connect(DB_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_unenriched(limit: int = 50) -> list[dict]:
    """Pull incidents that need processing (no severity yet)."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, raw_log, source
                FROM incidents
                WHERE severity IS NULL
                ORDER BY id ASC
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(row) for row in cur.fetchall()]


def fetch_unembedded(limit: int = 100) -> list[dict]:
    """Pull incidents that have no embedding yet."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, raw_log
                FROM incidents
                WHERE embedding IS NULL
                ORDER BY id ASC
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(row) for row in cur.fetchall()]


def update_embedding(incident_id: int, embedding: list[float]) -> None:
    """Write an embedding vector back to an incident row."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE incidents SET embedding = %s::vector WHERE id = %s",
                (str(embedding), incident_id),
            )


def update_enrichment(
    incident_id: int, severity: str, explanation: str
) -> None:
    """Write LLM enrichment results back to an incident row."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE incidents
                SET severity = %s, explanation = %s
                WHERE id = %s
                """,
                (severity, explanation, incident_id),
            )


def find_similar(embedding: list[float], limit: int = 5) -> list[dict]:
    """Find the N most similar past incidents by embedding distance."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, raw_log, source, severity, explanation
                FROM incidents
                WHERE embedding IS NOT NULL
                ORDER BY embedding <-> %s::vector
                LIMIT %s
                """,
                (str(embedding), limit),
            )
            return [dict(row) for row in cur.fetchall()]