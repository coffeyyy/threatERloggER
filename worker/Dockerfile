# syntax=docker/dockerfile:1.7
# Worker image for ECS Fargate.
# Long-running polling process; no HTTP port exposed.
#
# Build (from repo root):
#   docker build -f worker/Dockerfile -t threaterlogger-worker:latest .
#
# Run locally for testing:
#   docker run --rm \
#     -e DATABASE_URL=... \
#     -e GEMINI_API_KEY=... \
#     threaterlogger-worker:latest

# ---- Stage 1: build deps ----
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# scikit-learn wants a compiler for some wheels on certain arches.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY worker/requirements.txt ./
RUN pip install --prefix=/install -r requirements.txt

# ---- Stage 2: runtime ----
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/usr/local/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash app

COPY --from=builder /install /usr/local

WORKDIR /app
COPY --chown=app:app worker/ /app/

USER app

# Worker is a background loop, no port to expose, no HTTP healthcheck.
# ECS uses container exit code as its health signal.
# python -u disables stdout buffering so logs stream to CloudWatch in real time.

CMD ["python", "-u", "main.py"]