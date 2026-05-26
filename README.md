# threatERloggER

AI-powered log anomaly detection with semantic search and conversational analysis.
**Live demo:** https://davvrh8i6aup5.cloudfront.net
**API:** http://threaterlogger-alb-1997870568.us-east-2.elb.amazonaws.com/health
**Source:** https://github.com/coffeyyy/threatERloggER

---

## What it does

Ingests raw log lines from any source — web servers, distributed file systems, SSH daemons, application logs — and surfaces the ones worth paying attention to. Every log line is:

1. **Embedded** into a 1536-dimensional vector using Gemini embeddings
2. **Scored** by an Isolation Forest anomaly detector trained on historical data
3. **Enriched** for anomalous lines: an LLM produces severity, category, plain-English explanation, and recommended action
4. **Searchable** via natural-language chat over the corpus ("Are there any block replication issues?") using RAG against the same embeddings

The dashboard polls every 5 seconds, so streaming ingestion shows up almost live.

---

## Architecture

```
┌────────────┐    POST /ingest    ┌──────────────┐    write    ┌──────────────────┐
│  Sources   │ ─────────────────> │   FastAPI    │ ──────────> │   Postgres 18    │
│            │ <───────────────── │   Backend    │ <────────── │   + pgvector     │
└────────────┘   /incidents,/chat │   (Fargate)  │    read     │   (RDS)          │
                                   └──────────────┘             └──────────────────┘
                                          ▲                              ▲
                                          │                              │  embed +
                                  Angular │                              │  enrich
                                          │                              │
                                          │                       ┌──────┴──────┐
                                  ┌───────┴────────┐              │   Worker    │
                                  │  CloudFront +  │              │   (Fargate) │
                                  │  S3 (static)   │              └──────┬──────┘
                                  └────────────────┘                     │
                                                                         │ API
                                                                         ▼
                                                                  ┌─────────────┐
                                                                  │   Gemini    │
                                                                  └─────────────┘
```

**Backend** (`/backend`) — FastAPI exposing `/ingest`, `/incidents`, `/incidents/stats`, `/chat`, `/health`. Bearer-token auth on all endpoints except `/health`. Uses LangChain + `langchain-google-genai` for the RAG pipeline; Postgres handles vector similarity search via pgvector's `ivfflat` index.

**Worker** (`/worker`) — Long-running poller that processes new logs in two stages:

- `embedding_pass()` batches unembedded rows and writes vectors back
- `enrichment_pass()` scores each row with Isolation Forest, then enriches anomalies via `gemini-2.5-flash` with a defensive JSON schema

**Frontend** (`/frontend`) — Angular 17 dashboard. Login screen accepts the API token; subsequent requests carry it via an HTTP interceptor. Five metric tiles (Total / Critical / High / Med / Normal), a sortable incidents table, and a sidecar chat panel that hits `/chat` for RAG queries. Built once and shipped as static assets to S3 — no SSR in production.

**Storage** — Postgres 18 on RDS with pgvector 0.8.1. Partial indexes on `WHERE severity IS NULL` and `WHERE embedding IS NULL` so the worker only scans the work it needs to do. ivfflat index on the embedding column for sub-100ms vector search.

---

## Stack

| Layer           | Tech                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| Frontend        | Angular 17, TypeScript, RxJS, tabular CSS dashboard, HTTP interceptor for auth              |
| Backend         | FastAPI, Pydantic 2, LangChain, `psycopg2-binary`                                           |
| Worker          | Python, scikit-learn (Isolation Forest), OpenAI SDK against Gemini's OpenAI-compat endpoint |
| Storage         | Postgres 18 + pgvector 0.8.1                                                                |
| AI              | Gemini 1536-dim Matryoshka embeddings, `gemini-2.5-flash` for chat + enrichment             |
| Infrastructure  | AWS Fargate (ECS), RDS, ECR, S3, CloudFront, Secrets Manager, IAM, ALB                      |
| Container build | Docker, buildx (cross-arch from M-series Mac)                                               |
| Local dev       | Docker Compose for Postgres, Makefile for orchestration                                     |

---

## Running locally

Prereqs: Docker (or Colima), Python 3.12, Node 20, a Gemini API key.

```bash
git clone https://github.com/coffeyyy/threatERloggER.git
cd threatERloggER

cp .env.example .env
# Edit .env, set GEMINI_API_KEY and a strong API_TOKEN (any random string)

```

Visit http://localhost:4200, paste your `API_TOKEN`, and you're in.


---

## Worker tuning

The worker reads tuning knobs from environment variables. Defaults are conservative; bump them if you want to chew through a large backlog:

| Env var              | Default | What it does                            |
| -------------------- | ------- | --------------------------------------- |
| `POLL_INTERVAL_SEC`  | 3       | Sleep between work cycles               |
| `EMBED_BATCH_SIZE`   | 20      | Lines per embedding call                |
| `ENRICH_BATCH_SIZE`  | 10      | Anomalies enriched per cycle            |
| `ENRICH_CONCURRENCY` | 5       | Parallel enrichment workers             |
| `ANOMALY_THRESHOLD`  | -0.05   | Isolation Forest cutoff for "anomalous" |

For a free-tier Gemini key, drop these significantly: `EMBED_BATCH_SIZE=5`, `ENRICH_CONCURRENCY=1`, `POLL_INTERVAL_SEC=8`.

---

## API

All endpoints except `/health` require `Authorization: Bearer <API_TOKEN>`.

| Method | Path               | Notes                                                                                                                                        |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`          | No auth. Used by ALB health checks.                                                                                                          |
| POST   | `/ingest`          | Body: `{logs: string[], source: string}`. Writes raw rows; worker picks them up async.                                                       |
| GET    | `/incidents`       | Query: `?limit=N&only_anomalies=true`. Sorted critical → high → med → low → time desc.                                                       |
| GET    | `/incidents/stats` | Aggregate counts by severity. Powers the metric tiles.                                                                                       |
| GET    | `/incidents/{id}`  | Single incident with full enrichment.                                                                                                        |
| POST   | `/chat`            | Body: `{question: string, k: int=5}`. RAG: embeds question, retrieves top-k, stuffs into prompt. Returns `{answer, sources: IncidentRef[]}`. |

---

## AWS deployment

**Postgres** — RDS `db.t4g.micro` with pgvector built in (Postgres 16+ ships with it). Public-access enabled with a security group locked to my laptop IP plus the ECS task SG.

**Secrets** — `DATABASE_URL`, `GEMINI_API_KEY`, and `API_TOKEN` in Secrets Manager. The ECS task execution role has read access scoped to `threaterlogger/*` only; tasks reference secret ARNs in their definition, so the values are never stored in env files, images, or logs.

**Images** — Two ECR repos (`threaterlogger-backend`, `threaterlogger-worker`). Both built as multi-stage Dockerfiles with a slim Python 3.12 runtime; final images sit around 150MB. Cross-compiled for `linux/amd64` from an M-series Mac via `docker buildx`.

**Compute** — Two ECS Fargate services in the same cluster:

- `threaterlogger-backend`: 1 task, 0.25 vCPU / 0.5GB, behind an Application Load Balancer on port 80. ALB does health checks against `/health`. Container healthcheck via the Dockerfile's `HEALTHCHECK` as a second signal.
- `threaterlogger-worker`: 1 task, 0.5 vCPU / 1GB, no port mapping, no public IP needed beyond outbound to Gemini's API.

Both tasks log to CloudWatch Logs with 7-day retention. The log groups are pre-created so the task execution role doesn't need `logs:CreateLogGroup` (it's not in the AWS-managed policy by default).

**Frontend** — Angular production build synced to a private S3 bucket. CloudFront in front of it with Origin Access Control (OAC) — the bucket only allows reads from this specific CloudFront distribution, no public access. Custom error responses rewrite 403/404 → `/index.html` so Angular's client-side router works on refresh.

**IAM** — Two roles. Task execution role can pull from ECR, read the threaterlogger secrets, and write to CloudWatch. Task role (used by application code) is currently a no-op; would extend it later if the app started calling AWS services directly.



## Tear down

To stop the meter completely:

```bash
# Stop the services
aws ecs update-service --cluster threaterlogger-cluster \
  --service threaterlogger-backend --desired-count 0
aws ecs update-service --cluster threaterlogger-cluster \
  --service threaterlogger-worker --desired-count 0

# Delete the services and cluster
aws ecs delete-service --cluster threaterlogger-cluster \
  --service threaterlogger-backend --force
aws ecs delete-service --cluster threaterlogger-cluster \
  --service threaterlogger-worker --force
aws ecs delete-cluster --cluster threaterlogger-cluster

# Delete the ALB and target group (console is easier than CLI for this)
# Console → EC2 → Load Balancers → delete threaterlogger-alb

# Delete RDS (this also stops storage charges)
aws rds delete-db-instance --db-instance-identifier threaterlogger-db \
  --skip-final-snapshot --delete-automated-backups

# Delete CloudFront (must disable first, takes 5-10 min)
# Console → CloudFront → distribution → disable → wait → delete

# Empty + delete S3 bucket
aws s3 rm s3://threaterlogger-frontend-066949052004 --recursive
aws s3api delete-bucket --bucket threaterlogger-frontend-066949052004

```

---

## License

MIT.
