CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  raw_log TEXT NOT NULL,
  source VARCHAR(255),
  severity VARCHAR(50),
  explanation TEXT,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incidents_timestamp ON incidents(timestamp DESC);