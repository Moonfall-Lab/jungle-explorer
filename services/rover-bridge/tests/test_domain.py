import importlib.util
from pathlib import Path
import unittest


DOMAIN_PATH = Path(__file__).parents[1] / "app" / "domain.py"
SPEC = importlib.util.spec_from_file_location("rover_bridge_domain", DOMAIN_PATH)
domain = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(domain)


class RoverBridgeDomainTest(unittest.TestCase):
    def test_converts_motion_commands_to_sdk_sequence(self):
        sequence = domain.commands_to_sequence([
            {"action": "FORWARD", "cells": 2},
            {"action": "TURN_LEFT", "degrees": 90},
            {"action": "TURN_RIGHT", "degrees": 90},
            {"action": "FORWARD", "cells": 1},
        ])
        self.assertEqual(sequence, "F2 L R F1")

    def test_rejects_non_integer_or_arbitrary_motion(self):
        with self.assertRaises(domain.BridgeValidationError):
            domain.commands_to_sequence([{"action": "FORWARD", "cells": 1.5}])
        with self.assertRaises(domain.BridgeValidationError):
            domain.commands_to_sequence([{"action": "TURN_LEFT", "degrees": 45}])

    def test_maps_corrected_landscape_sdk_cells(self):
        self.assertEqual(domain.sdk_cell_to_position("A-1"), {"row": 0, "col": 0})
        self.assertEqual(domain.sdk_cell_to_position("H-5"), {"row": 4, "col": 7})
        self.assertEqual(domain.sdk_cell_to_position("D-3"), {"row": 2, "col": 3})

    def test_supports_legacy_transposed_sdk_during_migration(self):
        self.assertEqual(
            domain.sdk_cell_to_position("C-4", "legacy_transposed"),
            {"row": 2, "col": 3},
        )

    def test_rejects_cells_outside_selected_mapping(self):
        with self.assertRaises(domain.BridgeValidationError):
            domain.sdk_cell_to_position("H-5", "legacy_transposed")
        with self.assertRaises(domain.BridgeValidationError):
            domain.sdk_cell_to_position("E-8", "landscape")

    def test_maps_sdk_clockwise_headings(self):
        self.assertEqual(domain.sdk_heading_to_cardinal(0), "EAST")
        self.assertEqual(domain.sdk_heading_to_cardinal(90), "SOUTH")
        self.assertEqual(domain.sdk_heading_to_cardinal(180), "WEST")
        self.assertEqual(domain.sdk_heading_to_cardinal(-90), "NORTH")


if __name__ == "__main__":
    unittest.main()
