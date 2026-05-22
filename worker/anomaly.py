"""Statistical anomaly detection using IsolationForest over embeddings.

Friday morning task #3: fit on the corpus, score new incidents, persist the
model so the worker can reload it across restarts.
"""
import os
import pickle
from pathlib import Path
import numpy as np
from sklearn.ensemble import IsolationForest

MODEL_PATH = Path(os.getenv("ANOMALY_MODEL_PATH", "worker/anomaly_model.pkl"))

# Lower scores = more anomalous. Tune this against your seeded data.
ANOMALY_THRESHOLD = float(os.getenv("ANOMALY_THRESHOLD", "-0.05"))


def fit_model(embeddings: list[list[float]]) -> IsolationForest:
    """Fit IsolationForest on a corpus of embeddings.

    Note: IsolationForest on 1536-dim vectors is slow.
    Friday TODO: consider PCA to ~50 dims first, or subsample to <5k rows for fit.
    """
    X = np.array(embeddings)
    model = IsolationForest(
        n_estimators=100,
        contamination="auto",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X)
    return model


def save_model(model: IsolationForest) -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model, f)


def load_model() -> IsolationForest | None:
    if not MODEL_PATH.exists():
        return None
    with open(MODEL_PATH, "rb") as f:
        return pickle.load(f)


def score(model: IsolationForest, embedding: list[float]) -> float:
    """Return the anomaly score for a single embedding.

    score_samples returns higher values for normal points, lower for anomalies.
    Decision function in IsolationForest: roughly -0.5 to 0.5.
    """
    X = np.array([embedding])
    return float(model.score_samples(X)[0])


def is_anomaly(model: IsolationForest, embedding: list[float]) -> bool:
    return score(model, embedding) < ANOMALY_THRESHOLD
