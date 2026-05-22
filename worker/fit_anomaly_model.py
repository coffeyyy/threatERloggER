"""One-shot: fit the IsolationForest model on existing embeddings and save to disk.

Run after you've seeded enough logs and the worker has embedded them:
    cd worker && python fit_anomaly_model.py

Re-run any time you want to refresh the baseline.
"""
import logging
import sys
from dotenv import load_dotenv

load_dotenv()

import db
import anomaly


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("fit")


def main() -> None:
    log.info("fetching embeddings from db")
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, embedding FROM incidents WHERE embedding IS NOT NULL"
            )
            rows = cur.fetchall()

    if len(rows) < 100:
        log.error(
            "only %d embedded rows; need at least 100 (ideally 1000+) for a useful fit",
            len(rows),
        )
        sys.exit(1)

    log.info("parsing %d embeddings", len(rows))
    embs = []
    for _, emb in rows:
        if isinstance(emb, str):
            embs.append([float(x) for x in emb.strip("[]").split(",")])
        else:
            embs.append(list(emb))

    log.info("fitting IsolationForest (this can take a minute on 1536-dim vectors)")
    model = anomaly.fit_model(embs)

    anomaly.save_model(model)
    log.info("saved model to %s", anomaly.MODEL_PATH)


if __name__ == "__main__":
    main()
