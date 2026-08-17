# Device and service protocol

All grid coordinates are zero-based `{ row, col }`. UI labels are one-based. Distance is expressed in logical cells, angles are always 90 degrees, timestamps are ISO 8601 UTC, and confidence is `[0, 1]`.

## Game Server → rover bridge

```json
{
  "type": "EXECUTE_PLAN",
  "gameId": "game-abc123",
  "planId": "plan-4-2-5",
  "commands": [
    { "action": "FORWARD", "cells": 2 },
    { "action": "TURN_LEFT", "degrees": 90 },
    { "action": "FORWARD", "cells": 1 }
  ]
}
```

The rover must deduplicate `planId`, stop on malformed commands and expose an emergency-stop path.

The Moonfall Rover SDK itself accepts a compact sequence rather than this envelope. The local bridge converts the commands above to `F2 L F3`, calls `RoverSDK.execute`, and correlates the result with `planId`. See [`ROVER_SDK_INTEGRATION.md`](ROVER_SDK_INTEGRATION.md).

## Rover → Game Server

```json
{
  "type": "MOVE_FINISHED",
  "gameId": "game-abc123",
  "planId": "plan-4-2-5",
  "estimatedDistanceCm": 36.8,
  "durationMs": 2470
}
```

This transport-level message is optional when using the Python SDK directly. The authoritative logical position comes from `MissionResult.position.cell`, never from the planned target.

## Rover SDK/vision adapter → Game Server

```json
{
  "roverId": "rover-01",
  "position": { "row": 3, "col": 4 },
  "heading": "NORTH",
  "confidence": 0.94,
  "source": "APRILTAG",
  "capturedAt": "2026-08-17T10:00:00.000Z"
}
```

The current SDK already aggregates three stationary localization frames. The bridge accepts only `in_grid: true` with a non-null cell, converts the selected SDK grid mapping to the game's zero-based 5×8 coordinates, and records the remaining fields as telemetry. The generic API retains confidence for alternative vision adapters.

For the final landscape board the corrected SDK range is `A-1..H-5`. Bridge completion is posted to `POST /api/games/:id/rover-results` with `planId`; duplicate callbacks are idempotent and do not advance the round twice. SDK `0.1.0` orientation details are tracked in [`SDK_AUDIT.md`](SDK_AUDIT.md).

## rPPG → Game Server

```json
{
  "heartRate": 92,
  "hrv": 41,
  "tension": 0.67,
  "confidence": 0.82,
  "capturedAt": "2026-08-17T10:00:00.000Z"
}
```

Signals below 0.60 confidence are stored only if needed for diagnostics and are not incorporated into team tension. Team tension is exponentially smoothed; no physiological value directly changes HP, time, hazards or victory.

Runtime definitions live in `packages/protocol/src/index.ts`.
