"""AprilTag pixel-to-grid referee boundary.

Camera capture and tag detection are intentionally adapter functions: hardware teams can
plug OpenCV/pupil-apriltags in without changing the server protocol.
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Jungle Explorer Vision Tracking", version="0.1.0")


@dataclass(frozen=True)
class Calibration:
    origin_x: float = 100.0
    origin_y: float = 80.0
    cell_width: float = 120.0
    cell_height: float = 120.0
    rows: int = 5
    columns: int = 8


CALIBRATION = Calibration()


class TagDetection(BaseModel):
    rover_id: str = "rover-01"
    center_x: float
    center_y: float
    confidence: float = Field(ge=0, le=1)


def pixel_to_grid(x: float, y: float, calibration: Calibration) -> tuple[int, int]:
    col = round((x - calibration.origin_x) / calibration.cell_width)
    row = round((y - calibration.origin_y) / calibration.cell_height)
    if not (0 <= row < calibration.rows and 0 <= col < calibration.columns):
        raise ValueError("AprilTag center is outside the calibrated board")
    return row, col


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "adapter": "pixel-to-grid"}


@app.post("/localize")
def localize(detection: TagDetection) -> dict[str, object]:
    try:
        row, col = pixel_to_grid(detection.center_x, detection.center_y, CALIBRATION)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "roverId": detection.rover_id,
        "position": {"row": row, "col": col},
        "confidence": detection.confidence,
        "source": "APRILTAG",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
    }
