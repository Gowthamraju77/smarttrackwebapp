# SmartTrack display update and next product

Updated 2026-11-04. The ESP32 is on USB at the Linux working copy
`/home/gamma/esp32-diagnostics`. This Windows server holds the separate
`my projectt` application; its different firmware sources have not been overwritten.

- [Installed display update](DISPLAY-RTOS-UPDATE.md)
- [FreeRTOS implementation and staged architecture](RTOS-PLAN.md)
- [Product and seven-screen visual review](PRODUCT-REVIEW.md)
- [What to build next: trip tracker, bike tracker or field logger](BUILD-NEXT.md)

Final USB firmware ELF SHA-256:
`c14cfee617240be43876dd4603a6981f55187109dc4b39f15db983c5641266f8`

Build and all 127 tests passed; application flash hash and running identity
verified. Calibration survived, PSRAM passed, and the MPU worker runs. The final
one-minute USB/map workload recorded a maximum 23 ms touch-sampling gap and zero
input/MPU queue drops. These are observed software timings, not physical latency
guarantees. The user accepted the touch feel and requested product suggestions.

MPU and modem communication faults remain. Trip persistence, battery sensing,
return-to-start, movement alerts and SOS are proposals. The local report
`product-touch-verification.json` and `product-touch-install/` contain detailed
evidence; evidence paths inside these documents refer to the Linux working copy.
No credentials, device NVS, personal location samples or rendered GPS screenshots
are included in these server reports.
