# Firmware status

The active ESP32-C3 firmware is maintained with the motion SDK and localizer in:

- <https://github.com/Moonfall-Lab/moonfall-rover-control>

`firmware/rover-esp32` is an early interface scaffold retained for historical reference. Do not flash it for the current tabletop rover. Hardware and motion changes should be made and tested in the SDK repository; Jungle Explorer consumes the resulting `RoverSDK.execute(sequence)` boundary.
