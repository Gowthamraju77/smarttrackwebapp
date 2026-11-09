# Connection verification report

## Review orchestration

Ten independent connection-review tasks (C01–C10) and five independent audit tasks (V01–V05) were requested and completed. The creators supplied independent checks for shared buses, TFT, touch, GPS, MPU-9250, buttons, GPIO21 rail, A7670C, power budget, and troubleshooting. The auditors then compared the resulting connection contract against the supplied reference and the current firmware under `my projectt/firmware/`.

## Consensus results

| Area | Result | Evidence / action |
|---|---|---|
| Shared SPI GPIO12/11/13 | PASS as documented | TFT CS10 and touch CS14 must never be LOW together |
| I²C SDA17/SCL18 | PASS as documented | 4.7 kΩ pull-ups to 3V3; verify breakout resistors |
| ILI9341 mapping | PASS as documented | CS10, DC9, RST8, BL5 through NPN/base resistor |
| XPT2046 mapping | PASS as documented | CS14, IRQ15; runtime driver/arbitration still bench-required |
| NEO-M8N mapping | PASS as documented | GPS TX→GPIO6, GPIO7→GPS RX, 9600 baud |
| MPU-9250 hardware mapping | PASS as documented | Address 0x68; AD0 GND, NCS 3V3, FSYNC GND, INT16 |
| Button wiring | PASS in reference | Current firmware still needs GPIO4 power-button implementation |
| GPIO21 rail polarity | PASS at source intent | hi-Z off/reset/deep-sleep behavior still bench-required |
| A7670C default state | PASS fail-closed | Reserved GPIO47/48, separate 3.4–4.2 V ≥2 A supply |
| microSD | SAFE/disabled | CS is unspecified; current default must remain `-1` |
| Power budget | CONDITIONAL | Reference estimates only; measure actual regulator/rail |
| Current firmware completeness | NOT FULLY COMPLETE | GPIO4, GPIO16/MPU driver, display/touch runtime need qualification |

## Blocking findings before hardware sign-off

1. Add or document GPIO4 power-button shutdown and RTC wake behavior.
2. Add GPIO16 and a qualified MPU-9250 driver, or explicitly mark the IMU path as pending.
3. Integrate and test TFT/touch SPI transaction arbitration and backlight control.
4. Validate GPIO21 external P-FET gate behavior during reset, shutdown, and deep sleep.
5. Confirm actual board regulator, rail current, GPS acquisition inrush, and modem supply thermal capability.
6. Keep A7670C and microSD disabled until exact power/pin hardware is approved.

## Verification limitations

The audits were source/reference reviews. No assembled hardware, oscilloscope, power analyzer, SIM, GPS antenna test, Supabase deployment, or cellular TLS endpoint was available. Therefore this report must not be read as electrical or safety certification.
