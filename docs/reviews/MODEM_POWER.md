Remote progress report. The supplied source documents are in the server folder `connectionss`; local evidence copies are at `/home/gamma/esp32-diagnostics/modem-repair/provided-connections/`.

# A7670C power-path review — 2026-11-05

The user confirms an A7670C board connected to ESP32-S3 UART, powered from an
external 5 V source at a pin labelled **5V or VIN**, with modem GND joined to
ESP32 GND. The supply current rating, exact carrier model and measured voltages
are not yet known. The user subsequently reported approximately **4.98 V** and
confirmed solid red / blinking blue LEDs; the voltage measurement point and
transient behavior were not specified. This records the user's wiring report,
not continuity tests or independent electrical measurements.

## How the provided connections fit the current build

| Connection | Evidence / current state |
|---|---|
| Modem main TXD → ESP32 RX GPIO48 | Matches the provided wiring and running UART2 routing |
| ESP32 TX GPIO47 → modem main RXD | Matches the provided wiring and running UART2 routing |
| Modem GND ↔ ESP32 GND | Confirmed by the user |
| External 5 V → modem-board 5V/VIN | Confirmed by the user; exact carrier input rating/regulator remains unverified |
| Modem VBAT | Source design specifies 3.4–4.2 V, dedicated supply rated ≥2 A |
| GPIO21 peripheral rail | Supplies TFT/touch/MPU/GPS in the source design; does not establish modem power |
| UART level conversion | Required by source design; its presence on the actual carrier has not been established |
| Modem PWRKEY/DTR | No assigned/controlled ESP32 connection in current firmware |

The expected carrier-board arrangement is:

```text
External supply +5 V -> board input rated for 5 V -> board regulator -> modem VBAT
External supply GND ---------------------------> modem GND --------> ESP32 GND

Modem TXD -> verified UART level conversion -> ESP32 GPIO48 RX
Modem RXD <- verified UART level conversion <- ESP32 GPIO47 TX
```

An existing onboard converter should be used if the carrier provides compatible
UART levels. A bare A7670 UART uses 1.8 V logic. The diagram does not establish
that the actual board contains a regulator or converter. A VIN label alone is
not a manufacturer voltage/current specification.

## Important distinction in the supplied reference

`SmartTrack_Connections_Detailed.md` section 10 specifies modem **VBAT** at
3.4–4.2 V, a ≥2 A dedicated supply, ≥300 µF bulk capacitance and local ceramics.
Its section 12 recommendation of **5 V ≥1 A** concerns the ESP32/peripheral
regulator, not an unconditional modem power input.

Therefore 5 V directly at bare-module VBAT would exceed the documented limit.
Five volts at a carrier input designed to regulate it can be appropriate. The
user's latest answer identifies the input as 5V/VIN rather than VBAT, so the
next check is the carrier's regulation and load capability, not assuming an
overvoltage fault or lowering an unknown carrier's input blindly.

These source documents predate the connected modem, revised GPS RX39 and working
display. Their statements that the modem is unwired/disabled describe the older
design. They are not current hardware observations or electrical certification.

## What can and cannot be checked over the existing USB connection

The ESP32 is connected and receiving telemetry. UART2 scans still receive no
valid AT response. Its routing registers confirm software pin selection only.
No ADC divider, PMIC or voltage-monitor connection for the modem supply exists
in the current firmware. No external voltage measurement was made.

SIMCom documents `AT+CBC` returning e.g. `+CBC: 3.749V` followed by `OK`. This can
report module-side supply once an AT interface works. It cannot bypass the
present UART failure or establish the carrier VIN voltage/current capability;
it also cannot be assumed to capture brief supply dips.

## Next decisive checks

1. Read the source's current rating and identify the actual modem carrier's
   regulator/UART interface. Existing source documents do not name those parts.
2. Measure DC voltage between the carrier input and GND during normal power and
   startup. If a clearly labelled VBAT test point exists, measure it against
   GND and compare with the module specification. Avoid probing unidentified
   tiny module pins. A meter can miss brief dips; min/max or an oscilloscope
   gives stronger transient evidence.
3. Confirm the present power/status LED pattern and the board's startup method.
   LEDs are clues, not proof of AT readiness or network registration.
4. With supply/startup established, isolate the main UART and its level
   conversion. Once `AT` replies, check SIM state and network registration.

Exact provided documents and their remote paths/hashes are preserved in
`provided-connections/source-manifest.json`. This review does not claim repair.
