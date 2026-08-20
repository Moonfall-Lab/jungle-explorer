"""Pure protocol conversion for the Moonfall Rover SDK bridge."""

from __future__ import annotations

import math
import re
from typing import Any


class BridgeValidationError(ValueError):
    """The Game Server or SDK supplied an invalid protocol value."""


def commands_to_sequence(commands: list[dict[str, Any]]) -> str:
    if not commands:
        raise BridgeValidationError("motion command list cannot be empty")
    tokens: list[str] = []
    for command in commands:
        action = command.get("action")
        if action == "FORWARD":
            cells = command.get("cells")
            if isinstance(cells, bool) or not isinstance(cells, int) or cells <= 0:
                raise BridgeValidationError("FORWARD requires a positive integer cells value")
            tokens.append(f"F{cells}")
        elif action == "TURN_LEFT":
            if command.get("degrees") != 90:
                raise BridgeValidationError("TURN_LEFT must be exactly 90 degrees")
            tokens.append("L")
        elif action == "TURN_RIGHT":
            if command.get("degrees") != 90:
                raise BridgeValidationError("TURN_RIGHT must be exactly 90 degrees")
            tokens.append("R")
        else:
            raise BridgeValidationError(f"unsupported motion action: {action}")
    return " ".join(tokens)


def sdk_cell_to_position(cell: str, mapping: str = "landscape") -> dict[str, int]:
    normalized = cell.strip().upper()
    match = re.fullmatch(r"([A-Z])-(\d+)", normalized)
    if not match:
        raise BridgeValidationError(f"invalid SDK cell: {cell}")
    letter_index = ord(match.group(1)) - ord("A")
    number_index = int(match.group(2)) - 1

    if mapping == "landscape":
        # Correct 27-inch board contract: SDK A-1..H-5 = 8 columns × 5 rows.
        if not (0 <= letter_index < 8 and 0 <= number_index < 5):
            raise BridgeValidationError(f"landscape SDK cell is outside A-1..H-5: {cell}")
        return {"row": number_index, "col": letter_index}
    if mapping in {"row_letter", "legacy_transposed"}:
        # Product coordinate contract: A..E are rows; 1..8 are columns.
        if not (0 <= letter_index < 5 and 0 <= number_index < 8):
            raise BridgeValidationError(f"row-letter SDK cell is outside A-1..E-8: {cell}")
        return {"row": letter_index, "col": number_index}
    raise BridgeValidationError(f"unknown SDK grid mapping: {mapping}")


def game_position_to_sdk_cell(row: int, col: int, mapping: str = "landscape") -> str:
    if isinstance(row, bool) or isinstance(col, bool) or not isinstance(row, int) or not isinstance(col, int):
        raise BridgeValidationError("game position row and col must be integers")
    if not (0 <= row < 5 and 0 <= col < 8):
        raise BridgeValidationError(f"game position is outside the 5x8 board: row={row}, col={col}")
    if mapping == "landscape":
        return f"{chr(ord('A') + col)}-{row + 1}"
    if mapping in {"row_letter", "legacy_transposed"}:
        return f"{chr(ord('A') + row)}-{col + 1}"
    raise BridgeValidationError(f"unknown SDK grid mapping: {mapping}")


def sdk_heading_to_cardinal(heading_deg: float, offset_deg: float = 0) -> str:
    if not math.isfinite(heading_deg) or not math.isfinite(offset_deg):
        raise BridgeValidationError("heading and offset must be finite")
    # SDK coordinates use +X right and +Y down, so positive angles rotate clockwise.
    normalized = (heading_deg + offset_deg) % 360
    index = int(math.floor((normalized + 45) / 90)) % 4
    return ("EAST", "SOUTH", "WEST", "NORTH")[index]


def cardinal_to_sdk_heading(heading: str, offset_deg: float = 0) -> float:
    if not math.isfinite(offset_deg):
        raise BridgeValidationError("heading offset must be finite")
    values = {"EAST": 0.0, "SOUTH": 90.0, "WEST": 180.0, "NORTH": -90.0}
    if heading not in values:
        raise BridgeValidationError(f"unknown cardinal heading: {heading}")
    raw = values[heading] - offset_deg
    return (raw + 180.0) % 360.0 - 180.0
