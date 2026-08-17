"""rPPG service contract and confidence gate.

The production signal extractor (face ROI, POS/CHROM filtering and quality estimation)
belongs behind this boundary. This scaffold accepts already extracted windows so no
unvalidated medical claim is made by placeholder data.
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Jungle Explorer rPPG", version="0.1.0")


class SignalEstimate(BaseModel):
    heart_rate: float = Field(ge=30, le=240)
    hrv: float | None = Field(default=None, ge=0, le=300)
    tension: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "classification": "gameplay-context-only"}


@app.post("/estimate")
def estimate(signal: SignalEstimate) -> dict[str, object]:
    return {
        "heartRate": signal.heart_rate,
        "hrv": signal.hrv,
        "tension": signal.tension,
        "confidence": signal.confidence,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "accepted": signal.confidence >= 0.6,
        "disclaimer": "Contextual gameplay input; not a medical measurement.",
    }
