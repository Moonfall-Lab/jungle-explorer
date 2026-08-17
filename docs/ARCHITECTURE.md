# Architecture decisions

## 1. One source of truth

`apps/game-server` owns the authoritative `GameState`. The state contains hidden `truth`, player-facing `knowledge`, rover state, clock, objectives, Agent context and a bounded event log. Player serialization deletes `truth`; Observer serialization adds truth and the inferred risk map explicitly.

The physical sequence is intentionally asymmetric:

1. Agent selects a target and emits a command plan.
2. ESP32 executes timed movement.
3. The rover completion message is operational telemetry only.
4. Overhead vision localizes the AprilTag.
5. Game Server accepts a confidence-gated grid position and only then reveals/resolves that tile.

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

## 5. Production hardening backlog

- Persist events and snapshots in PostgreSQL or SQLite; restore after process loss.
- Add operator/observer authorization and redact truth at the network boundary.
- Use WebSocket or MQTT transport with plan idempotency, acknowledgements and emergency stop.
- Record calibration version with every localization.
- Model two rovers as separate actors if the final rules use both simultaneously.
- Add deterministic dynamic-hazard movement rules after playtesting.
- Add OpenTelemetry traces across plan, device command and localization correlation ids.
