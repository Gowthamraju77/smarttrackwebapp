# SmartTrack — Detailed Hardware Connections and Verification Manual

**Project:** SmartTrack GPS-based smart tracking and emergency response system  
**Target MCU:** ESP32-S3 N16R8 (16 MB flash / 8 MB OPI PSRAM)  
**Firmware framework:** Arduino core 3.x / PlatformIO target  
**Document status:** Engineering connection reference; bench verification is still required  
**Authoritative source:** supplied `CONNECTIONS_PER_COMPONENT.pdf` and the project pin contract  
**Reference PDF SHA-256:** `dd20b8c0fef6298299574673f23cc62609d07a380c66f4268f2f78ec37f64538`

## 1. How to use this document

This manual describes the wiring contract supplied for the SmartTrack build. It is intended to be used during schematic review, harness construction, firmware configuration, continuity testing, and staged bring-up.

The GPIO numbers below are authoritative for this build. Do not substitute a different GPIO because it is convenient in a sketch. Any change must update the schematic, firmware configuration, test plan, and this manual together.

### Evidence labels

- **Reference-defined:** stated in the supplied connection document.
- **Firmware-defined:** represented in `my projectt/firmware/`.
- **Bench-required:** cannot be proven from source files; requires the assembled board and a meter, oscilloscope, or module test.
- **Reserved/unwired:** intentionally not connected in the current build.

### Golden electrical rule

All module logic is **3.3 V only**. Never feed 5 V into an ESP32-S3 GPIO, SPI line, I²C line, UART line, button input, or sensor strap. The ordinary 5 V in the reference is USB VBUS before the board's onboard 3V3 regulator; it is not an ESP32 logic rail.

## 2. Complete net and rail summary

| Net / function | ESP32-S3 GPIO | Direction from MCU | Rail | Connected component(s) | State / note |
|---|---:|---|---|---|---|
| SPI SCK | 12 | OUT | 3V3 switched | ILI9341 + XPT2046 | Shared master clock |
| SPI MOSI | 11 | OUT | 3V3 switched | ILI9341 + XPT2046 | MCU drives data to slaves |
| SPI MISO | 13 | IN | 3V3 switched | ILI9341 + XPT2046 | Only selected CS-low slave drives |
| TFT chip select | 10 | OUT | 3V3 switched | ILI9341 | Active LOW |
| TFT data/command | 9 | OUT | 3V3 switched | ILI9341 | DC/RS |
| TFT reset | 8 | OUT | 3V3 switched | ILI9341 | Active LOW |
| TFT backlight control | 5 | OUT | 3V3 switched | NPN driver | PWM; never drive LED current directly |
| Touch chip select | 14 | OUT | 3V3 switched | XPT2046 | Active LOW |
| Touch IRQ | 15 | IN | 3V3 switched | XPT2046 | Wired; firmware may poll |
| I²C SDA | 17 | I/O | 3V3 switched | MPU-9250 | 4.7 kΩ pull-up to 3V3 |
| I²C SCL | 18 | OUT | 3V3 switched | MPU-9250 | 4.7 kΩ pull-up to 3V3 |
| MPU data-ready INT | 16 | IN | 3V3 switched | MPU-9250 | Reference-defined; current firmware gap |
| GPS UART RX | 6 | IN | 3V3 switched | GPS TX | UART1 crossover; 9600 baud |
| GPS UART TX | 7 | OUT | 3V3 switched | GPS RX | UART1 crossover; 9600 baud |
| Power button | 4 | IN | 3V3 always-on | Button to GND | External 10 kΩ pull-up; RTC-capable |
| SOS button | 1 | IN | 3V3 always-on | Button to GND | Internal pull-up; hold ≥1200 ms |
| User button | 2 | IN | 3V3 always-on | Button to GND | Internal pull-up; long press ≥2000 ms |
| Peripheral enable | 21 | OUT / hi-Z | always-on gate | P-FET high-side switch | LOW = switched rail ON |
| Modem RX reservation | 48 | reserved | separate modem | A7670C future UART | Leave unconnected now |
| Modem TX reservation | 47 | reserved | separate modem | A7670C future UART | Leave unconnected now |
| microSD CS | -1 | disabled | not assigned | microSD future | Do not guess a GPIO |
| Modem PWRKEY | -1 | disabled | separate modem | A7670C future | No current ESP32 assignment |
| Common ground | GND | power return | GND | Every module/button/MCU | One common ground is mandatory |

## 3. Shared-bus wiring

### 3.1 Shared SPI bus

Wire the SPI bus once, then fan it out to the TFT and touch controller:

```text
ESP32 GPIO12 (SCK)  ───────── ILI9341 SCK / XPT2046 T_CLK
ESP32 GPIO11 (MOSI) ───────── ILI9341 SDI / XPT2046 T_DIN
ESP32 GPIO13 (MISO) ───────── ILI9341 SDO / XPT2046 T_DO
ESP32 GPIO10 (CS)   ───────── ILI9341 CS
ESP32 GPIO14 (CS)   ───────── XPT2046 T_CS
ESP32 GPIO15        ───────── XPT2046 T_IRQ
```

The ESP32 is the only SPI master. SCK and MOSI are always MCU-driven. MISO is shared and depends on the unselected device releasing the line to high impedance.

**Mandatory CS rule:** GPIO10 and GPIO14 must never be LOW at the same instant. Before selecting one device, drive the other device's CS HIGH. If a future microSD device is added, its qualified CS must also be mutually exclusive with both GPIO10 and GPIO14.

At boot, de-select all SPI slaves before enabling the switched rail or starting a transaction. Use explicit SPI transactions when device modes or clock speeds differ. The current firmware declares the pins, but the TFT/touch runtime driver and complete CS arbitration still require integration and bench testing.

### 3.2 I²C bus

```text
ESP32 GPIO17 (SDA) ───── MPU-9250 SDA
ESP32 GPIO18 (SCL) ───── MPU-9250 SCL
ESP32 GPIO16 (INT) ───── MPU-9250 INT (reference-defined)
ESP32 GND          ───── MPU-9250 GND
3V3 switched       ───── MPU-9250 VCC/VDD
```

Use 4.7 kΩ pull-ups from SDA and SCL to 3.3 V. Verify whether the breakout already contains pull-ups; do not blindly install duplicate pull-ups. SDA/SCL must not be connected to 5 V.

## 4. ILI9341 TFT display

| ILI9341 module pin | Connect to | Rail / direction | Detailed note |
|---|---|---|---|
| VCC | switched 3V3 | power | Turns off with GPIO21 rail |
| GND | common GND | return | Required shared ground |
| SCK/CLK | GPIO12 | OUT | Shared SPI clock |
| SDI/MOSI | GPIO11 | OUT | Shared SPI data-in |
| SDO/MISO | GPIO13 | IN | Must release when CS HIGH |
| CS | GPIO10 | OUT | Active LOW; TFT-only |
| DC/RS | GPIO9 | OUT | Data/command select |
| RESET | GPIO8 | OUT | Active LOW |
| LED/BLK | GPIO5 through NPN + base resistor | OUT/PWM | Do not source panel current from GPIO |

Typical reference load is about 20 mA for logic plus about 80 mA for the backlight at full brightness. The backlight may be PWM-dimmed. The exact display breakout's regulator, LED topology, and transistor values remain **bench/BOM verification items**.

### TFT bring-up

1. Confirm VCC is 3.3 V switched and GND is common.
2. Confirm RESET, DC, CS, and shared SPI lines with continuity testing.
3. Keep touch CS HIGH during TFT initialization.
4. Reset the panel LOW then HIGH according to the selected library.
5. Enable the NPN backlight driver only after the rail and logic are confirmed.
6. Run a fill-color and text test before adding touch transactions.

White or blank TFT symptoms commonly indicate RESET GPIO8, DC GPIO9, CS GPIO10, backlight GPIO5, or power-rail wiring faults.

## 5. XPT2046 touch controller

| XPT2046 module pin | Connect to | Note |
|---|---|---|
| VCC | switched 3V3 | Less than 1 mA typical reference load |
| GND | common GND | Shared return |
| T_CLK | GPIO12 | Shared SPI SCK |
| T_DIN | GPIO11 | Shared SPI MOSI |
| T_DO | GPIO13 | Shared SPI MISO; high-Z when CS HIGH |
| T_CS | GPIO14 | Active LOW; touch-only |
| T_IRQ | GPIO15 | Wired input; current reference says firmware polls it |

The touch controller must not share a LOW CS interval with the TFT. Restore each device's SPI mode and speed if the selected libraries require different settings. The current firmware has the pin contract but does not yet prove an integrated XPT2046 driver, calibration flow, or runtime CS lock.

## 6. u-blox NEO-M8N GPS

| GPS pin | ESP32-S3 connection | Detail |
|---|---|---|
| VCC | switched 3V3 | Approximately 29 mA typical, 67 mA maximum reference |
| GND | common GND | Required |
| GPS TX (output) | GPIO6 / ESP RX | UART1 crossover |
| GPS RX (input) | GPIO7 / ESP TX | UART1 crossover |
| ANT | active antenna | Clear sky view; away from switching noise |

Use UART1 at 9600 baud. The wiring must be crossed: **GPS TX → ESP GPIO6 RX**, and **ESP GPIO7 TX → GPS RX**. Never wire TX-to-TX or RX-to-RX.

Place approximately 100 µF bulk capacitance close to GPS VCC and another bulk capacitor on the switched rail near the GPS. The reference gives roughly 50 mA cold-acquisition current and another 10–20 mA for an active antenna. Cold fix time can be approximately 30 seconds to several minutes depending on antenna and sky view.

Keep the antenna away from the ESP32, TFT, switching supply, high-current modem wiring, motors, speakers, and metal enclosure parts. GPS bytes without a fix usually indicate antenna/sky-view or acquisition conditions; no bytes usually indicate crossover, baud, VCC, or switched-rail faults.

## 7. MPU-9250 IMU

| MPU-9250 pin | Connect to | Detail |
|---|---|---|
| VCC/VDD | switched 3V3 | 3.3 V only |
| GND | common GND | Required |
| SDA | GPIO17 | I²C bidirectional |
| SCL | GPIO18 | I²C clock |
| INT | GPIO16 | Data-ready input; firmware integration gap |
| AD0 | GND | Selects address `0x68` |
| NCS/CS | 3V3 switched | Forces I²C mode; do not float |
| FSYNC | GND | Disables frame sync |
| EDA/ECL | unconnected | Auxiliary external-magnetometer bus unused |

The expected address is `0x68`. Verify `WHO_AM_I` on the actual breakout. The reference mentions approximately 3.9 mA active and very low sleep current. Keep the IMU away from magnets, motors, speakers, steel hardware, and high-current modem paths. Verify breakout pull-ups and board orientation before calibration.

**Current project gap:** the firmware initializes `Wire` but leaves MPU acquisition/calibration unavailable, and the current configuration does not yet represent GPIO16 or the static strap wiring in code. The connection is documented, not fully software-verified.

## 8. Buttons and always-on controls

### Power button — GPIO4

Connect one side of the button to GPIO4 and the other side to common GND. Use an **external 10 kΩ pull-up to always-on 3.3 V** and a 100 nF debounce capacitor from GPIO4 to GND. It is active LOW, RTC-capable, and intended for long-press shutdown and deep-sleep wake.

Do not put this pull-up on the switched rail. The power button must remain usable while GPIO21 has disabled peripherals.

### SOS button — GPIO1

Connect the button between GPIO1 and GND. It is active LOW and uses the internal approximately 45 kΩ pull-up for normal operation. The reference firmware behavior is a hold of at least 1200 ms to latch SOS. SOS must not depend on GPS, ML, or a working modem to latch locally.

If SOS wake-from-deep-sleep is later enabled, add a qualified external always-on pull-up because internal pull-ups may not hold during deep sleep.

### User button — GPIO2

Connect the button between GPIO2 and GND. It is active LOW and uses the internal pull-up for normal operation. The reference behavior is a short tap for `markCount` and a long press of at least 2000 ms to clear a locally latched SOS. Clearing a local latch must not erase the server-side event or falsely imply assistance.

## 9. GPIO21 peripheral rail switch

The switched 3.3 V rail is created by a high-side P-FET or a specifically qualified load-switch implementation:

```text
Always-on 3V3 ── P-FET source
                   P-FET drain ── switched 3V3 ── TFT/touch/MPU/GPS VCC
GPIO21 ── gate drive
Always-on 3V3 ── 100 kΩ gate pull-up
```

Reference truth table:

| GPIO21 state | P-FET / switched rail | Meaning |
|---|---|---|
| LOW | ON / 3V3 switched live | Peripherals powered |
| hi-Z with external pull-up | OFF / rail disabled | Reset/shutdown/deep-sleep-safe default |

The supplied reference distinguishes this active-low P-FET circuit from a TPS22918. They are not pin/control-equivalent and must not be interchanged without a new schematic and polarity review.

The current firmware uses a driven HIGH for initial software-off and LOW for on; this is electrically consistent with active-low polarity but does not fully implement the reference's hi-Z sleep convention. The external pull-up must still establish the hardware reset default. Rail-off and deep-sleep sequences require bench validation.

## 10. A7670C cellular modem — reserved in this build

The A7670C is **not wired or enabled in the current build**. Keep the reserved pins unconnected until the board, regulator, level shifter, PWRKEY, SIM, antenna, and TLS transport are fully qualified.

| Modem function | ESP32 reservation | Current state |
|---|---|---|
| Modem TX → ESP RX | GPIO48 | Reserved; leave unconnected |
| ESP TX → modem RX | GPIO47 | Reserved; leave unconnected |
| Modem PWRKEY | no assigned GPIO | Reserved; no code now |
| Modem VBAT | separate 3.4–4.2 V supply | Never ESP32 3V3 |
| Modem GND | common GND | Required return |

Required future modem power characteristics from the reference:

- Dedicated 3.4–4.2 V regulator/supply rated for at least 2 A.
- At least 300 µF bulk capacitance plus local ceramics.
- Common ground with the ESP32.
- UART interface level-shifted to 3.3 V after verifying the exact module breakout voltage.
- Future PWRKEY operation is approximately a 50 ms LOW pulse, but the actual board must be validated before assigning a GPIO.
- LTE transmit bursts can approach 2 A; the ESP32 3V3 rail must never be used for modem VBAT.

CRC32 can detect accidental transmission corruption, truncation, or mismatch. It is **not authentication or encryption**. Production cellular traffic requires HTTPS/TLS with certificate/hostname validation, device authentication, replay protection, and server authorization.

## 11. microSD status

The supplied connection reference does not define a microSD chip-select GPIO for this build. Therefore:

- Keep `SMARTTRACK_SD_CS_PIN=-1` / disabled until the physical display/SD board and CS net are confirmed.
- Do not reuse GPIO3 or any other sketch placeholder without an approved schematic.
- If enabled later, the SD card must be checked for 3.3 V logic compatibility and added to the SPI CS mutual-exclusion table.
- SD write, power-loss recovery, and offline queue behavior require a real card and fault-injection test.

## 12. Power budget and rail planning

The reference values are datasheet-typical or community-measured estimates, not measurements on the assembled SmartTrack board.

| Load | Rail | Typical reference | Peak / note |
|---|---|---:|---|
| ESP32-S3 core, Wi-Fi off | always-on 3V3 | ~120 mA | Wi-Fi TX bursts ~283–340 mA |
| ILI9341 TFT + backlight | switched 3V3 | ~100 mA | ~20 mA logic + ~80 mA backlight |
| NEO-M8N GPS | switched 3V3 | ~29 mA | 67 mA max; cold acquire ~50 mA |
| Active GPS antenna | GPS module path | +10–20 mA | Depends on antenna |
| MPU-9250 | switched 3V3 | ~3.9–4 mA | ~8 µA sleep reference |
| XPT2046 | switched 3V3 | <1 mA | Negligible reference |

The normal switched cluster is approximately 133–134 mA before antenna allowance and design headroom. The source document reports about 274 mA total with Wi-Fi off, which includes headroom/antenna allowance. A genuine 800 mA–1 A 3.3 V regulator fed by a 5 V source rated at least 1 A is the conditional reference recommendation. A bare 500 mA USB port is marginal when Wi-Fi bursts overlap the peripheral load.

### Required power checks before module connection

1. Check for shorts between every rail and GND with power removed.
2. Confirm always-on 3V3 and switched 3V3 polarity and voltage with a meter.
3. Confirm GPIO21 gate pull-up and P-FET source/drain orientation.
4. Power the ESP32 alone and confirm the switched rail default state.
5. Add GPS/TFT/IMU/touch one at a time while monitoring rail voltage and current.
6. Measure brownout behavior during GPS acquisition and TFT backlight enable.
7. Do not connect the A7670C until its independent regulator and bulk capacitance are load-tested.

## 13. Staged bring-up and acceptance tests

### Stage A — unpowered inspection

- Verify every table row with continuity testing.
- Verify all module grounds join the common ground.
- Verify no ESP32 GPIO is connected to a 5 V signal.
- Verify TFT and touch CS are separate and not shorted.
- Verify GPS TX/RX crossover.
- Verify MPU AD0/NCS/FSYNC straps.
- Verify button pull-ups use the always-on domain.
- Verify A7670C is physically separated from ESP32 3V3 and remains reserved.

### Stage B — MCU and rail

- Boot ESP32 with all peripherals disconnected.
- Confirm GPIO21 external pull-up holds the rail off during reset.
- Confirm firmware enables the rail only after safe GPIO setup.
- Measure always-on and switched 3V3 under no-load and incremental loads.

### Stage C — sensors

- GPS: confirm 9600-baud NMEA bytes, checksum-valid sentences, then wait for a real fix.
- IMU: scan I²C and verify address `0x68` / expected `WHO_AM_I`.
- Confirm missing GPS/IMU values remain unavailable rather than being shown as zero.

### Stage D — display and touch

- Run TFT reset/fill/text test.
- Run touch test with TFT CS held HIGH.
- Calibrate touch coordinates and document rotation.
- Enable backlight through the NPN stage and measure current.

### Stage E — storage and cellular

- microSD remains disabled until its CS is qualified.
- For modem bring-up, use a dedicated supply, level shifters, antenna, SIM, certificate chain, clock, and HTTPS endpoint.
- Test retry/idempotency and confirm records are removed from the offline queue only after an exact server receipt.

### Stage F — emergency path

- Hold SOS for at least 1200 ms with GPS unavailable and confirm local latch.
- Confirm the event is queued without ML inference.
- Confirm server delivery, acknowledgment, and resolution are recorded as separate states.
- Confirm the user-button clear action does not erase server audit history.

## 14. Troubleshooting matrix

| Symptom | Likely cause | Corrective action |
|---|---|---|
| White/blank TFT | RESET8/DC9/CS10/backlight5 or rail | Check wiring, CS, reset timing, NPN driver, and switched 3V3 |
| TFT works but touch is dead | Touch CS14/MISO13 or SPI mode | Check CS exclusivity, shared MISO, IRQ15/polling, calibration |
| No GPS bytes | Wrong crossover, baud, VCC off | GPS TX→GPIO6, GPIO7→GPS RX, 9600, switched rail on |
| GPS bytes but never a fix | Antenna/sky view/acquisition time | Clear sky view, active antenna, wait, add GPS bulk cap |
| IMU not detected | Address/straps/SDA/SCL/pullups | AD0 GND, NCS 3V3, FSYNC GND, address 0x68, verify 4.7 kΩ |
| Reset during GPS acquire | Rail or regulator sag | Add/verify 100 µF caps, stronger source, measure current |
| Buttons never register | Pull-up on switched rail | Move pull-up to always-on; verify active LOW |
| Everything dies after shutdown | Expected switched-rail behavior | Only always-on core/buttons remain; verify wake plan |
| Wi-Fi causes resets | Weak USB/source transient | Stronger 5 V source and bulk capacitance; duty-cycle Wi-Fi |
| Modem brownouts | Wrong rail or inadequate supply | Separate 3.4–4.2 V ≥2 A supply and ≥300 µF bulk |
| Modem sends plaintext | Unsafe transport fallback | Disable modem; require qualified HTTPS/TLS and certificate validation |

## 15. Project-specific verification findings

The independent review set identified these important alignment items:

1. The hardware reference requires power button GPIO4, but the current firmware configuration and main loop do not yet implement GPIO4 shutdown/wake behavior.
2. The hardware reference assigns MPU INT GPIO16 and static straps; the current firmware only initializes I²C and does not yet provide a qualified MPU driver.
3. TFT/touch GPIO constants exist, but a complete runtime display/touch driver and CS transaction arbitration are not yet proven by hardware tests.
4. The current firmware defaults SD CS and modem PWRKEY to `-1`, which is the safe choice until those connections are physically qualified.
5. GPIO21 software polarity is active-low correct, but the reference's hi-Z rail-off behavior and reset/deep-sleep sequence still require board-level validation.
6. Current and capacitor values in this document are estimates from the supplied reference, not certification for the actual ESP32 board revision or breakout modules.

## 16. Final do-not-connect summary

- Do not connect 5 V to an ESP32 GPIO or 3.3 V-only signal.
- Do not drive TFT backlight current directly from GPIO5.
- Do not pull GPIO10 and GPIO14 LOW together.
- Do not put button pull-ups on switched 3V3.
- Do not power A7670C from ESP32 3V3.
- Do not connect reserved GPIO47/48 or invent a PWRKEY GPIO in this build.
- Do not enable an unknown microSD CS pin.
- Do not treat CRC32 as authentication.
- Do not treat a stale/last-known GPS coordinate as current.
- Do not present an ML Trust Score until a real, evaluated, promoted artifact exists.
- Do not consider this manual a replacement for continuity, voltage, thermal, RF, and end-to-end bench testing.
