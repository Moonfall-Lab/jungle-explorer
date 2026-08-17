"""Idempotent async bridge from Jungle Explorer plans to Moonfall RoverSDK."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
import threading
from typing import Any, Literal
import urllib.request

from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field

from .domain import BridgeValidationError, commands_to_sequence, sdk_cell_to_position, sdk_heading_to_cardinal

app = FastAPI(title="Jungle Explorer Rover Bridge", version="0.1.0")


class MotionCommand(BaseModel):
    action: Literal["FORWARD", "TURN_LEFT", "TURN_RIGHT"]
    cells: int | None = Field(default=None, gt=0)
    degrees: Literal[90] | None = None


class RoverConfig(BaseModel):
    ip: str = Field(min_length=1)
    port: int = Field(default=8888, ge=1, le=65535)
    localizer_url: str = "http://127.0.0.1:8098"
    tag_id: int = Field(default=0, ge=0)
    tag_gap_cm: float = Field(default=0, ge=0)
    cell_cm: float = Field(default=6.68, gt=0)
    straight_speed: int = Field(default=60, ge=1, le=100)
    straight_cm_s: float = Field(default=8.91, gt=0)
    turn_speed: int = Field(default=40, ge=1, le=100)
    left_turn_sec: float = Field(default=0.692, gt=0)
    right_turn_sec: float = Field(default=0.901, gt=0)
    settle_sec: float = Field(default=0.25, ge=0)
    localization_timeout_sec: float = Field(default=5, gt=0, le=60)
    localization_samples: int = Field(default=3, ge=1, le=20)
    grid_mapping: Literal["landscape", "legacy_transposed"] = "landscape"
    heading_offset_deg: float = 0


class MissionRequest(BaseModel):
    plan_id: str = Field(alias="planId", min_length=1)
    game_id: str = Field(alias="gameId", min_length=1)
    commands: list[MotionCommand] = Field(min_length=1)
    rover: RoverConfig
    callback_url: str | None = Field(default=None, alias="callbackUrl")


class MissionSnapshot(BaseModel):
    plan_id: str = Field(alias="planId")
    game_id: str = Field(alias="gameId")
    status: Literal["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]
    sequence: str
    position: dict[str, int] | None = None
    heading: str | None = None
    sdk_telemetry: dict[str, Any] | None = Field(default=None, alias="sdkTelemetry")
    error: str | None = None


@dataclass
class MissionRecord:
    plan_id: str
    game_id: str
    sequence: str
    status: str = "RUNNING"
    position: dict[str, int] | None = None
    heading: str | None = None
    sdk_telemetry: dict[str, Any] | None = None
    error: str | None = None
    sdk: Any = field(default=None, repr=False)

    def snapshot(self) -> MissionSnapshot:
        return MissionSnapshot(
            planId=self.plan_id,
            gameId=self.game_id,
            status=self.status,
            sequence=self.sequence,
            position=self.position,
            heading=self.heading,
            sdkTelemetry=self.sdk_telemetry,
            error=self.error,
        )


MISSIONS: dict[str, MissionRecord] = {}
LOCK = threading.Lock()


def require_token(value: str | None) -> None:
    expected = os.getenv("ROVER_BRIDGE_TOKEN", "")
    if expected and value != expected:
        raise HTTPException(status_code=401, detail="invalid rover bridge token")


def post_callback(record: MissionRecord, callback_url: str | None) -> None:
    if not callback_url:
        return
    payload = record.snapshot().model_dump(by_alias=True, exclude_none=True)
    request = urllib.request.Request(
        callback_url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Rover-Token": os.getenv("ROVER_BRIDGE_TOKEN", ""),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=3):
            pass
    except OSError as error:
        # The mission remains queryable; a callback failure must never re-run the rover.
        record.error = f"callback failed after {record.status}: {error}"


def run_mission(record: MissionRecord, request: MissionRequest) -> None:
    try:
        from rover_agent import MotionConfig, RoverSDK

        motion = MotionConfig(
            cell_cm=request.rover.cell_cm,
            straight_speed=request.rover.straight_speed,
            straight_cm_s=request.rover.straight_cm_s,
            turn_speed=request.rover.turn_speed,
            left_turn_sec=request.rover.left_turn_sec,
            right_turn_sec=request.rover.right_turn_sec,
            settle_sec=request.rover.settle_sec,
        )
        sdk = RoverSDK(
            request.rover.ip,
            robot_port=request.rover.port,
            localizer_url=request.rover.localizer_url,
            rover_tag_id=request.rover.tag_id,
            tag_gap_cm=request.rover.tag_gap_cm,
            motion=motion,
        )
        with LOCK:
            record.sdk = sdk
        try:
            result = sdk.execute(
                record.sequence,
                localization_timeout_sec=request.rover.localization_timeout_sec,
                localization_samples=request.rover.localization_samples,
            )
            sdk_position = result.position.to_dict()
            if not sdk_position.get("in_grid") or not sdk_position.get("cell"):
                raise BridgeValidationError("SDK returned an out-of-grid position")
            position = sdk_cell_to_position(
                str(sdk_position["cell"]), request.rover.grid_mapping
            )
            heading = sdk_heading_to_cardinal(
                float(sdk_position["heading_deg"]), request.rover.heading_offset_deg
            )
            with LOCK:
                record.position = position
                record.heading = heading
                record.sdk_telemetry = result.to_dict()
                record.status = "COMPLETED"
        finally:
            sdk.close()
    except ModuleNotFoundError as error:
        with LOCK:
            record.status = "FAILED"
            record.error = f"Moonfall Rover SDK is not installed: {error}"
    except Exception as error:  # SDK exception types are optional until the private package is installed.
        name = type(error).__name__
        with LOCK:
            record.status = "CANCELLED" if name == "MissionCancelled" else "FAILED"
            record.error = f"{name}: {error}"
    finally:
        with LOCK:
            record.sdk = None
        post_callback(record, request.callback_url)


@app.get("/health")
def health() -> dict[str, object]:
    try:
        import rover_agent  # noqa: F401
        sdk_installed = True
    except ModuleNotFoundError:
        sdk_installed = False
    return {
        "status": "ok" if sdk_installed else "degraded",
        "sdkInstalled": sdk_installed,
        "expectedGrid": "8-columns-x-5-rows",
    }


@app.post("/missions", response_model=MissionSnapshot, response_model_by_alias=True)
def create_mission(
    request: MissionRequest,
    response: Response,
    x_rover_token: str | None = Header(default=None),
) -> MissionSnapshot:
    require_token(x_rover_token)
    try:
        sequence = commands_to_sequence([command.model_dump(exclude_none=True) for command in request.commands])
    except BridgeValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    with LOCK:
        existing = MISSIONS.get(request.plan_id)
        if existing:
            response.status_code = 200
            return existing.snapshot()
        record = MissionRecord(request.plan_id, request.game_id, sequence)
        MISSIONS[request.plan_id] = record
    threading.Thread(target=run_mission, args=(record, request), daemon=True).start()
    response.status_code = 202
    return record.snapshot()


@app.get("/missions/{plan_id}", response_model=MissionSnapshot, response_model_by_alias=True)
def get_mission(plan_id: str, x_rover_token: str | None = Header(default=None)) -> MissionSnapshot:
    require_token(x_rover_token)
    with LOCK:
        record = MISSIONS.get(plan_id)
        if not record:
            raise HTTPException(status_code=404, detail="mission not found")
        return record.snapshot()


@app.post("/missions/{plan_id}/stop", response_model=MissionSnapshot, response_model_by_alias=True)
def stop_mission(plan_id: str, x_rover_token: str | None = Header(default=None)) -> MissionSnapshot:
    require_token(x_rover_token)
    with LOCK:
        record = MISSIONS.get(plan_id)
        if not record:
            raise HTTPException(status_code=404, detail="mission not found")
        sdk = record.sdk
    if sdk is not None:
        sdk.stop()
    return record.snapshot()
