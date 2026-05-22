# Worker

Standalone Python process that enriches incoming logs. Runs separately from
FastAPI to keep the ingest hot path fast.

## Pipeline

```
new incidents (severity IS NULL)
    │
    ▼
[embedding pass] ── OpenAI text-embedding-3-small ──▶ writes embedding column
    │
    ▼
[anomaly scoring] ── IsolationForest on embeddings
    │
    ├─ normal   ──▶ mark severity=low, explanation="(normal)"
    │
    └─ anomaly  ──▶ [enrichment] ── GPT-4o-mini + similar past incidents
                                    ──▶ writes severity + explanation
```

## Files

| File | What it does |
|------|--------------|
| `main.py` | Main polling loop. Run with `python main.py`. |
| `db.py` | Postgres helpers (fetch, update, similarity search). |
| `embeddings.py` | OpenAI embedding wrapper with retries. |
| `anomaly.py` | IsolationForest training + scoring + persistence. |
| `enrichment.py` | LLM call with Pydantic structured output. |
| `fit_anomaly_model.py` | One-shot script to fit the anomaly model after seeding. |

## First run

```bash
cd worker
pip install -r requirements.txt

# Make sure the repo-root .env has DATABASE_URL and OPENAI_API_KEY set.
# Or copy .env into worker/ — load_dotenv() looks in cwd.

# 1. Start the worker. It will embed any existing incidents but skip enrichment
#    (no model on disk yet).
python main.py

# 2. After ~1000+ incidents are embedded, fit the anomaly model in another shell:
python fit_anomaly_model.py

# 3. Restart the worker. It'll now score + enrich anomalies.
```

## Tuning

- `POLL_INTERVAL_SEC` — how often to poll for new work (default 5s).
- `EMBED_BATCH_SIZE` — how many incidents to embed per OpenAI call (default 20).
- `ENRICH_BATCH_SIZE` — how many to enrich per loop (default 10).
- `ANOMALY_THRESHOLD` — score_samples cutoff; lower = stricter (default -0.05).
- `CHAT_MODEL` — override the LLM model (default `gpt-4o-mini`).

## Friday TODOs (per project plan)

- [ ] HDFS seed script in `/infra` to bulk-load 5–10k real logs.
- [ ] `enrichment_pass` currently does two queries per row — collapse into one.
- [ ] Consider PCA-50 before IsolationForest if 1536-dim fit is too slow.
- [ ] Add pgvector index (`ivfflat` or `hnsw`) on `embedding` column.
- [ ] Add a partial index on `WHERE severity IS NULL` for fast worker polling.
