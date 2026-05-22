from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
from datetime import datetime
import os
from dotenv import load_dotenv
import uvicorn

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
if not DB_URL:
    print("failed to fetch DB_URL")
elif DB_URL:
    print("successfully grabbed DB_URL")

class LogBatch(BaseModel):
    logs: list[str]
    source: str = "unknown"
    
class ChatRequest(BaseModel):
    question: str
    k: int = 5

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
        print(e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/incidents")
async def get_incidents(limit: int = 100, only_anomalies: bool = False):
    """Get recent incidents. Anomalies (severity != 'low') sort to the top."""
    try:
        with psycopg2.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                where_clause = "WHERE severity IS NOT NULL AND severity != 'low'" if only_anomalies else ""
                cur.execute(
                    f"""
                    SELECT id, timestamp, raw_log, source, severity, explanation
                    FROM incidents
                    {where_clause}
                    ORDER BY
                      CASE severity
                        WHEN 'critical' THEN 0
                        WHEN 'high' THEN 1
                        WHEN 'med' THEN 2
                        WHEN 'low' THEN 3
                        ELSE 4
                      END,
                      timestamp DESC
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
    
@app.post("/chat")
async def chat(req: ChatRequest):
    """Answer a natural-language question by retrieving relevant incidents and asking the LLM."""
    from chat import answer_question  # lazy import — keeps FastAPI startup fast
    try:
        result = answer_question(req.question, k=req.k)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)