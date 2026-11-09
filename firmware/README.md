# SmartTrack firmware

The firmware target is an Arduino/PlatformIO ESP32-S3 build. The pin map in
`include/config.h` is the supplied contract: GPS uses RX6/TX7, I2C uses SDA17
and SCL18, and the TFT/touch/button pins are explicit there. GPIO21 is an
active-low P-FET peripheral control; it is not interchangeable with the
TPS22918 control in the reference material.

## Safe defaults

The default environment keeps the modem disabled, leaves modem PWRKEY at
`-1`, and leaves microSD CS at `-1`. Therefore the default build does not
initialize UART 48/47, drive an unknown power key, transmit, or claim SD
durability. `Sensors` reports unavailable GPS/IMU values as unavailable; it
does not synthesize readings. SOS is latched independently of GPS, IMU, ML, or
modem readiness and is queued when a board-qualified SD configuration is
provided.

## Queue and delivery boundary

Telemetry and SOS payloads are serialized once, CRC32 is calculated over
those exact UTF-8 bytes, and the append-only queue retains them across retry.
Only a response with `accepted:true`, the exact queued `record_id`, and a
boolean `duplicate` is appended to the acknowledgment journal. HTTP success,
malformed JSON, TLS failure, or a different ID cannot remove a record.

## Hardware qualification still required

Before enabling a modem or SD build, validate the exact board/module: modem
UART voltage levels, PWRKEY timing and polarity, GPIO48/board-LED interaction,
TLS certificate/hostname/clock behavior, SD CS wiring, and regulator thermal
and peak-current capability. The transport interface deliberately fails closed
until a board-specific TLS backend is supplied.
