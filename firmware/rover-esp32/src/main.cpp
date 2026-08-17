#include <Arduino.h>
#include <ArduinoJson.h>

// Pin assignments are placeholders; validate against the team's motor driver before flashing.
constexpr int LEFT_MOTOR_FORWARD = 25;
constexpr int RIGHT_MOTOR_FORWARD = 26;
constexpr unsigned long CELL_TRAVEL_MS = 780;
constexpr unsigned long QUARTER_TURN_MS = 420;

void stopMotors() {
  digitalWrite(LEFT_MOTOR_FORWARD, LOW);
  digitalWrite(RIGHT_MOTOR_FORWARD, LOW);
}

void forwardOneCell() {
  digitalWrite(LEFT_MOTOR_FORWARD, HIGH);
  digitalWrite(RIGHT_MOTOR_FORWARD, HIGH);
  delay(CELL_TRAVEL_MS);
  stopMotors();
}

void setup() {
  Serial.begin(115200);
  pinMode(LEFT_MOTOR_FORWARD, OUTPUT);
  pinMode(RIGHT_MOTOR_FORWARD, OUTPUT);
  stopMotors();
  Serial.println("Jungle Rover ready; transport adapter pending Wi-Fi provisioning.");
}

void loop() {
  // Production adapter: parse EXECUTE_PLAN JSON from WebSocket/MQTT, execute each
  // integer cell/90-degree command, then emit MOVE_FINISHED. AprilTag remains authoritative.
  delay(1000);
}
