# syntax=docker/dockerfile:1.7
# Backend (FastAPI) image for ECS Fargate / ECS Express Mode.
#
# Build (from repo root):
#   docker build -f backend/Dockerfile -t threaterlogger-backend:latest .
#
# Run locally for testing:
#   docker run --rm -p 8000:8000 \
#     -e DATABASE_URL=... \
#     -e GEMINI_API_KEY=... \
#     -e API_TOKEN=... \
#     threaterlogger-backend:latest

# ---- Stage 1: build deps ----
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# psycopg2-binary doesn't need build tools, but pinning these makes the
# layer reusable if you swap to psycopg2 (source) later.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/requirements.txt ./
RUN pip install --prefix=/install -r requirements.txt

# ---- Stage 2: runtime ----
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/usr/local/bin:$PATH

# Runtime libs only (libpq for psycopg2-binary, curl for healthcheck).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash app

COPY --from=builder /install /usr/local

WORKDIR /app
COPY --chown=app:app backend/ /app/

USER app

EXPOSE 8000

# ECS Express Mode hits this; also wired into the in-container healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Single-process is fine for our load; bump --workers for higher RPS.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]