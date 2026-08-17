# Hardware integration

The active rover motion, AprilTag localizer and hardware debug UI live in the independent [Moonfall Rover SDK](https://github.com/Moonfall-Lab/moonfall-rover-control) repository. This repository does not duplicate that implementation. The Jungle Explorer adapter contract is documented in [`docs/ROVER_SDK_INTEGRATION.md`](../docs/ROVER_SDK_INTEGRATION.md).

The physical rover executes only integer-cell forward moves and 90° turns. Motor timing is an estimate; `RoverSDK.execute()` waits for the post-movement AprilTag localization and returns the final grid position used by the Game Server.

Safety requirements:

- validate motor pins and polarity on a lifted chassis before floor tests;
- add a physical power cutoff and software emergency-stop path;
- reject localization below 0.60 confidence and request a stationary re-scan;
- calibrate the four board corners before every installation;
- never use rPPG output as a medical reading or a direct win/loss trigger.

See `electronics/BOM.csv` for the starter bill of materials. CAD, wiring diagrams and printable tabletop assets can be added without changing the software protocol.
