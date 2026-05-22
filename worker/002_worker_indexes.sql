-- Run against an already-initialized db to add the indexes the worker needs.
-- Safe to re-run thanks to IF NOT EXISTS.
--
--   docker-compose exec -T db psql -U threaterlogger -d threaterlogger \
--       < infra/002_worker_indexes.sql

-- Fast lookup of incidents the worker still needs to process.
CREATE INDEX IF NOT EXISTS idx_incidents_unenriched
  ON incidents (id)
  WHERE severity IS NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_unembedded
  ON incidents (id)
  WHERE embedding IS NULL;

-- Approximate nearest-neighbor index on the embedding column.
-- ivfflat needs the table to have data before it's useful; if you create it
-- on an empty table, that's fine, but re-run REINDEX after seeding.
-- Tune `lists` roughly = sqrt(rows). 100 is fine up to ~10k rows.
CREATE INDEX IF NOT EXISTS idx_incidents_embedding
  ON incidents
  USING ivfflat (embedding vector_l2_ops)
  WITH (lists = 100);
