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

from .domain import (
    BridgeValidationError,
    cardinal_to_sdk_heading,
    commands_to_sequence,
    game_position_to_sdk_cell,
    sdk_cell_to_position,
    sdk_heading_to_cardinal,
)

app = FastAPI(title="Jungle Explorer Rover Bridge", version="0.1.0")


class MotionCommand(BaseModel):
    action: Literal["FORWARD", "TURN_LEFT", "TURN_RIGHT"]
    cells: int | None = Field(default=None, gt=0)
    degrees: Literal[90] | None = None


class GridPosition(BaseModel):
    row: int = Field(ge=0, le=4)
    col: int = Field(ge=0, le=7)


class RoverConfig(BaseModel):
    ip: str = Field(min_length=1)
    port: int = Field(default=8888, ge=1, le=65535)
    localizer_url: str = "http://127.0.0.1:8098"
    tag_id: int = Field(default=0, ge=0)
    tag_gap_cm: float = Field(default=0, ge=0)
    rover_center_offset_cm: float = Field(default=0, ge=-10, le=10)
    cell_cm: float = Field(default=6.68, gt=0)
    straight_speed: int = Field(default=60, ge=1, le=100)
    straight_cm_s: float = Field(default=8.91, gt=0)
    turn_speed: int = Field(default=40, ge=1, le=100)
    left_turn_sec: float = Field(default=0.692, gt=0)
    right_turn_sec: float = Field(default=0.901, gt=0)
    settle_sec: float = Field(default=0.25, ge=0)
    localization_timeout_sec: float = Field(default=5, gt=0, le=60)
    localization_samples: int = Field(default=3, ge=1, le=20)
    localization_mode: Literal["required", "disabled"] = "required"
    grid_mapping: Literal["row_letter", "landscape", "legacy_transposed"] = "landscape"
    heading_offset_deg: float = 0
    closed_loop_enabled: bool = False
    position_tolerance_cm: float = Field(default=0.90, gt=0, le=3.34)
    heading_tolerance_deg: float = Field(default=10, gt=0, le=30)
    correction_drive_speed: int = Field(default=60, ge=1, le=100)
    correction_turn_speed: int = Field(default=40, ge=1, le=100)
    correction_min_pulse_sec: float = Field(default=0.10, gt=0, le=1)
    correction_max_drive_pulse_sec: float = Field(default=0.14, gt=0, le=2)
    correction_max_turn_pulse_sec: float = Field(default=0.30, gt=0, le=2)
    correction_settle_sec: float = Field(default=0.35, ge=0, le=3)
    correction_samples: int = Field(default=5, ge=1, le=20)
    correction_max_iterations: int = Field(default=24, ge=1, le=40)


class MissionSegment(BaseModel):
    commands: list[MotionCommand] = Field(min_length=1)
    target: GridPosition
    target_heading: Literal["NORTH", "EAST", "SOUTH", "WEST"] = Field(
        alias="targetHeading"
    )


class MissionRequest(BaseModel):
    plan_id: str = Field(alias="planId", min_length=1)
    game_id: str = Field(alias="gameId", min_length=1)
    commands: list[MotionCommand] = Field(min_length=1)
    target: GridPosition | None = None
    target_heading: Literal["NORTH", "EAST", "SOUTH", "WEST"] | None = Field(
        default=None, alias="targetHeading"
    )
    segments: list[MissionSegment] = Field(default_factory=list)
    rover: RoverConfig
    callback_url: str | None = Field(default=None, alias="callbackUrl")


class MissionSnapshot(BaseModel):
    plan_id: str = Field(alias="planId")
    game_id: str = Field(alias="gameId")
    status: Literal[
        "RUNNING", "MOTION_COMPLETED", "COMPLETED", "FAILED", "CANCELLED"
    ]
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
        from rover_agent import ClosedLoopConfig, MotionConfig, RoverSDK

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
            rover_center_offset_cm=request.rover.rover_center_offset_cm,
            motion=motion,
        )
        with LOCK:
            record.sdk = sdk
        try:
            if request.rover.localization_mode == "disabled":
                result = sdk.execute_motion(record.sequence)
                with LOCK:
                    record.sdk_telemetry = result.to_dict()
                    record.status = "MOTION_COMPLETED"
            else:
                closed_loop = ClosedLoopConfig(
                    position_tolerance_cm=request.rover.position_tolerance_cm,
                    heading_tolerance_deg=request.rover.heading_tolerance_deg,
                    drive_speed=request.rover.correction_drive_speed,
                    turn_speed=request.rover.correction_turn_speed,
                    min_pulse_sec=request.rover.correction_min_pulse_sec,
                    max_drive_pulse_sec=request.rover.correction_max_drive_pulse_sec,
                    max_turn_pulse_sec=request.rover.correction_max_turn_pulse_sec,
                    settle_sec=request.rover.correction_settle_sec,
                    sample_count=request.rover.correction_samples,
                    max_iterations=request.rover.correction_max_iterations,
                )
                segment_results = []
                if request.rover.closed_loop_enabled and request.segments:
                    for segment in request.segments:
                        segment_sequence = commands_to_sequence([
                            command.model_dump(exclude_none=True)
                            for command in segment.commands
                        ])
                        result = sdk.execute(
                            segment_sequence,
                            localization_timeout_sec=request.rover.localization_timeout_sec,
                            localization_samples=request.rover.localization_samples,
                            target_cell=game_position_to_sdk_cell(
                                segment.target.row,
                                segment.target.col,
                                request.rover.grid_mapping,
                            ),
                            target_heading_deg=cardinal_to_sdk_heading(
                                segment.target_heading,
                                request.rover.heading_offset_deg,
                            ),
                            closed_loop=closed_loop,
                        )
                        segment_results.append(result.to_dict())
                else:
                    target_cell = None
                    target_heading_deg = None
                    if request.rover.closed_loop_enabled and request.target is not None:
                        target_cell = game_position_to_sdk_cell(
                            request.target.row,
                            request.target.col,
                            request.rover.grid_mapping,
                        )
                        if request.target_heading is not None:
                            target_heading_deg = cardinal_to_sdk_heading(
                                request.target_heading,
                                request.rover.heading_offset_deg,
                            )
                    result = sdk.execute(
                        record.sequence,
                        localization_timeout_sec=request.rover.localization_timeout_sec,
                        localization_samples=request.rover.localization_samples,
                        target_cell=target_cell,
                        target_heading_deg=target_heading_deg,
                        closed_loop=closed_loop if target_cell is not None else None,
                    )
                    segment_results.append(result.to_dict())
                sdk_position = result.position.to_dict()
                if not sdk_position.get("in_grid") or not sdk_position.get("cell"):
                    raise BridgeValidationError("SDK returned an out-of-grid position")
                position = sdk_cell_to_position(
                    str(sdk_position["cell"]), request.rover.grid_mapping
                )
                heading = sdk_heading_to_cardinal(
                    float(sdk_position["heading_deg"]), request.rover.heading_offset_deg
                )
                telemetry = result.to_dict()
                telemetry["sequence"] = record.sequence
                telemetry["action_count"] = sum(
                    int(item["action_count"]) for item in segment_results
                )
                telemetry["movement_duration_sec"] = round(
                    sum(float(item["movement_duration_sec"]) for item in segment_results),
                    3,
                )
                telemetry["segments"] = segment_results
                with LOCK:
                    record.position = position
                    record.heading = heading
                    record.sdk_telemetry = telemetry
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
        "supportsMotionOnly": True,
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
