# Device and service protocol

All grid coordinates are zero-based `{ row, col }`. UI labels are one-based. Distance is expressed in logical cells, angles are always 90 degrees, timestamps are ISO 8601 UTC, and confidence is `[0, 1]`.

## Game Server → rover

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

This message asks vision to adjudicate; it does not update the logical position.

## Vision → Game Server

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

The MVP acceptance threshold is 0.60. A production installation should require multiple stationary frames and a calibration version.

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
