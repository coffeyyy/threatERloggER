-- Run against an already-initialized db to add the indexes the worker needs.
-- Safe to re-run thanks to IF NOT EXISTS.
--
--   psql "host=... user=threaterlogger ..." -f infra/002_worker_indexes.sql

-- Fast lookup of incidents the worker still needs to process.
CREATE INDEX IF NOT EXISTS idx_incidents_unenriched
  ON incidents (id)
  WHERE severity IS NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_unembedded
  ON incidents (id)
  WHERE embedding IS NULL;

-- Approximate nearest-neighbor index on the embedding column.
-- ivfflat needs the table to have data before it's useful; creating it on
-- an empty table is fine, but you'll want REINDEX after seeding for speed.
-- Tune `lists` roughly = sqrt(rows). 100 is fine up to ~10k rows.
CREATE INDEX IF NOT EXISTS idx_incidents_embedding
  ON incidents
  USING ivfflat (embedding vector_l2_ops)
  WITH (lists = 100);