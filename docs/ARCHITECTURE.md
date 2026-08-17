# Architecture decisions

## 1. One source of truth

`apps/game-server` owns the authoritative `GameState`. The state contains hidden `truth`, player-facing `knowledge`, rover state, clock, objectives, Agent context and a bounded event log. Player serialization deletes `truth`; Observer serialization adds truth and the inferred risk map explicitly.

The physical sequence is intentionally asymmetric:

1. Agent selects a target and emits a command plan.
2. Game Server idempotently dispatches the plan to `services/rover-bridge`.
3. The Bridge converts commands to `F/L/R` tokens and calls the external Python `RoverSDK`.
4. ESP32 executes timed movement and stops.
5. The SDK aggregates post-movement AprilTag frames and returns the actual final cell.
6. The Bridge maps that cell to the 5×8 game coordinate and callbacks with the same `planId`.
7. Game Server accepts the result once and only then reveals/resolves that tile.

This prevents wheel slip, collision or calibration error from desynchronizing the tabletop and screen.

## 2. Deterministic rules before LLM narration

The decision path is:

```text
Intent card → candidate filter → minesweeper risk map → policy score
            → A* route → physical commands → templated explanation
```

Rules and path selection are deterministic and testable. A future LLM adapter may paraphrase explanations or understand richer player discussion, but its output must validate against an `ActionPlan` Schema and cannot mutate hidden board truth directly.

## 3. State layers

- **Memory**: revealed tiles, forgotten tiles, exact triggered hazards, resources and path hints.
- **Solver**: local eight-neighbor constraints and a bounded probability estimate.
- **Navigation**: risk-weighted Manhattan A*; diagonal intent candidates become physical cardinal paths.
- **Tactical policy**: persona, intent, information value, resources, return-to-base progress and smoothed tension.
- **Narration**: player-facing rationale and hazard/resource events.

## 4. Ports and adapters

Vision and rPPG run as Python services because their likely dependencies differ from the TypeScript game stack. Their current applications are stable API boundaries, not fake perception algorithms. Camera capture, AprilTag detection, face ROI and signal extraction can be replaced independently.

`ROVER_MODE=virtual` is a development adapter. `ROVER_MODE=hardware` requires explicit localization and therefore exercises the same authority boundary as the installation.

The physical tabletop has its own `apps/web-board` client. It renders only the square 5×8 board at a fixed 8:5 aspect ratio so HUD layout changes cannot alter physical cell geometry. The player and observer applications remain separate screens.

## 5. Production hardening backlog

- Persist events and snapshots in PostgreSQL or SQLite; restore after process loss.
- Add operator/observer authorization and redact truth at the network boundary.
- Use WebSocket or MQTT transport with plan idempotency, acknowledgements and emergency stop.
- Record calibration version with every localization.
- Model two rovers as separate actors if the final rules use both simultaneously.
- Add deterministic dynamic-hazard movement rules after playtesting.
- Add OpenTelemetry traces across plan, device command and localization correlation ids.
