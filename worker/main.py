"""Worker main loop.

Polls Postgres for unprocessed incidents and runs them through two stages:
  1. Embedding: every incident gets a vector.
  2. Enrichment: only anomalous incidents get severity + explanation.

Run as a standalone process (not inside FastAPI):
    cd worker && python main.py
"""
import logging
import os
import time
from dotenv import load_dotenv

load_dotenv()

import db
import embeddings
import anomaly
import enrichment
from concurrent.futures import ThreadPoolExecutor, as_completed


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("worker")

POLL_INTERVAL = float(os.getenv("POLL_INTERVAL_SEC", "8"))
EMBED_BATCH = int(os.getenv("EMBED_BATCH_SIZE", "5"))
ENRICH_BATCH = int(os.getenv("ENRICH_BATCH_SIZE", "3"))
ENRICH_CONCURRENCY = int(os.getenv("ENRICH_CONCURRENCY", "1"))


def embedding_pass() -> int:
    """Embed any incidents missing a vector. Returns count processed."""
    rows = db.fetch_unembedded(limit=EMBED_BATCH)
    if not rows:
        return 0

    texts = [r["raw_log"] for r in rows]
    log.info("embedding %d rows", len(texts))
    vectors = embeddings.embed_batch(texts)

    for row, vec in zip(rows, vectors):
        db.update_embedding(row["id"], vec)

    return len(rows)





def _process_one_incident(row: dict, model) -> tuple[int, bool]:
    """Score and (if anomalous) enrich a single incident. Returns (id, was_enriched)."""
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT embedding FROM incidents WHERE id = %s", (row["id"],))
            result = cur.fetchone()
            if not result or result[0] is None:
                return (row["id"], False)
            emb_str = result[0]
            if isinstance(emb_str, str):
                embedding = [float(x) for x in emb_str.strip("[]").split(",")]
            else:
                embedding = list(emb_str)

    if not anomaly.is_anomaly(model, embedding):
        db.update_enrichment(row["id"], severity="low", explanation="(normal)")
        return (row["id"], False)

    similar = db.find_similar(embedding, limit=5)
    similar = [s for s in similar if s["id"] != row["id"]]

    try:
        result = enrichment.enrich(row["raw_log"], similar=similar)
        db.update_enrichment(
            row["id"],
            severity=result.severity,
            explanation=result.explanation,
        )
        log.info("enriched id=%s severity=%s", row["id"], result.severity)
        return (row["id"], True)
    except Exception as e:
        log.exception("enrichment failed for id=%s: %s", row["id"], e)
        return (row["id"], False)


def enrichment_pass(model) -> int:
    """Score embedded-but-unenriched incidents in parallel."""
    if model is None:
        log.debug("no anomaly model loaded yet, skipping enrichment pass")
        return 0

    rows = db.fetch_unenriched(limit=ENRICH_BATCH)
    if not rows:
        return 0

    enriched_count = 0
    with ThreadPoolExecutor(max_workers=ENRICH_CONCURRENCY) as pool:
        futures = [pool.submit(_process_one_incident, row, model) for row in rows]
        for fut in as_completed(futures):
            _id, was_enriched = fut.result()
            if was_enriched:
                enriched_count += 1
    return enriched_count


def main() -> None:
    log.info("worker starting; poll interval %.1fs", POLL_INTERVAL)
    if not os.getenv("DATABASE_URL"):
        log.error("DATABASE_URL is not set; check your .env")
        return
    if not os.getenv("GEMINI_API_KEY"):
        log.warning("GEMINI_API_KEY is not set; embedding and enrichment will fail")

    model = anomaly.load_model()
    if model is None:
        log.warning(
            "no anomaly model on disk at %s; run seed/fit script first. "
            "Embedding will still run; enrichment will be skipped until a model exists.",
            anomaly.MODEL_PATH,
        )

    while True:
        try:
            embedded = embedding_pass()
            enriched = enrichment_pass(model)
            if embedded == 0 and enriched == 0:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            log.info("worker stopped by user")
            break
        except Exception as e:
            log.exception("worker loop error: %s", e)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()