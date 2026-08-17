from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


BRIDGE_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(BRIDGE_ROOT))

try:
    from app import main  # noqa: E402
except ModuleNotFoundError as error:
    if error.name in {"fastapi", "pydantic"}:
        raise unittest.SkipTest("rover bridge dependencies are not installed") from error
    raise


class FakeMotionResult:
    def to_dict(self):
        return {
            "sequence": "F1 L",
            "action_count": 2,
            "movement_duration_sec": 1.25,
        }


class FakeSDK:
    instances = []

    def __init__(self, robot_ip, **kwargs):
        self.robot_ip = robot_ip
        self.kwargs = kwargs
        self.motion_sequences = []
        self.localization_called = False
        self.closed = False
        self.__class__.instances.append(self)

    def execute_motion(self, sequence):
        self.motion_sequences.append(sequence)
        return FakeMotionResult()

    def execute(self, *_args, **_kwargs):
        self.localization_called = True
        raise AssertionError("motion-only mode must not call execute()")

    def stop(self):
        pass

    def close(self):
        self.closed = True


class MotionOnlyBridgeTest(unittest.TestCase):
    def setUp(self):
        FakeSDK.instances.clear()

    def test_motion_only_mission_skips_localization(self):
        request = main.MissionRequest.model_validate({
            "planId": "plan-motion-only",
            "gameId": "game-1",
            "commands": [
                {"action": "FORWARD", "cells": 1},
                {"action": "TURN_LEFT", "degrees": 90},
            ],
            "rover": {
                "ip": "127.0.0.1",
                "localization_mode": "disabled",
            },
        })
        record = main.MissionRecord(
            request.plan_id,
            request.game_id,
            "F1 L",
        )
        fake_module = types.ModuleType("rover_agent")
        fake_module.MotionConfig = lambda **kwargs: kwargs
        fake_module.RoverSDK = FakeSDK

        with patch.dict(sys.modules, {"rover_agent": fake_module}):
            main.run_mission(record, request)

        sdk = FakeSDK.instances[0]
        self.assertEqual(record.status, "MOTION_COMPLETED")
        self.assertEqual(record.position, None)
        self.assertEqual(record.sdk_telemetry["action_count"], 2)
        self.assertEqual(sdk.motion_sequences, ["F1 L"])
        self.assertFalse(sdk.localization_called)
        self.assertTrue(sdk.closed)


if __name__ == "__main__":
    unittest.main()
