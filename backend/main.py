from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI() 

# CORS for localhost:4200 (Angular)
app.add_middleware( 
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_URL = os.getenv("DATABASE_URL")

class LogBatch(BaseModel):
    logs: list[str]
    source: str = "unknown"

class IncidentResponse(BaseModel):
    id: int
    timestamp: str
    raw_log: str
    source: str
    severity: str | None
    explanation: str | None

@app.post("/ingest")
async def ingest_logs(batch: LogBatch):
    """Ingest a batch of log lines"""
    try:
        with psycopg2.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                for log in batch.logs:
                    cur.execute(
                        """
                        INSERT INTO incidents (raw_log, source)
                        VALUES (%s, %s)
                        """,
                        (log, batch.source)
                    )
                conn.commit()
        return {"status": "ok", "count": len(batch.logs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/incidents")
async def get_incidents(limit: int = 100):
    """Get recent incidents"""
    try:
        with psycopg2.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, timestamp, raw_log, source, severity, explanation
                    FROM incidents
                    ORDER BY timestamp DESC
                    LIMIT %s
                    """,
                    (limit,)
                )
                rows = cur.fetchall()
                return [
                    {
                        "id": row[0],
                        "timestamp": row[1].isoformat() if row[1] else None,
                        "raw_log": row[2],
                        "source": row[3],
                        "severity": row[4],
                        "explanation": row[5]
                    }
                    for row in rows
                ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/incidents/{id}")
async def get_incident(id: int):
    """Get a single incident"""
    try:
        with psycopg2.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, timestamp, raw_log, source, severity, explanation
                    FROM incidents
                    WHERE id = %s
                    """,
                    (id,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Not found")
                return {
                    "id": row[0],
                    "timestamp": row[1].isoformat() if row[1] else None,
                    "raw_log": row[2],
                    "source": row[3],
                    "severity": row[4],
                    "explanation": row[5]
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)