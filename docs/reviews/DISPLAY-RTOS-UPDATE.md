# SmartTrack display and FreeRTOS update

Work date: 2026-11-04. This work continues session
`01a1a6f1-04f2-7250-a661-6a307b3b82fe` on the local ESP32-S3 connected by USB.
The local working project is `/home/gamma/esp32-diagnostics`; the separate
Windows project is `C:\Users\muppa\omnirush.ai\my projectt` on Omnirush Projects.

## What changed

Normal navigation uses a brief firm tap and release. Input is sampled every
8 ms, including between completed LCD stripes, and press/release transitions
are retained until LVGL processes them. Isolated ADC outliers are filtered and
release is debounced for 24 ms. Calibration keeps the saved NVS format and
still intentionally asks for stable target contact.

Home has larger icons, restrained accent colors, visible button feedback,
and labeled 96 × 44 pixel Back/Home controls. Wi-Fi state and GPS readiness are
explicit. Missing GPS/MPU/modem data and unavailable laptop maps remain visible
as missing data. No battery percentages or successful emergency delivery are
invented.

The framework already contains FreeRTOS. The first application task split
moves MPU I²C initialization, sampling and retry waits into one worker. Copied
snapshots and bounded complete telemetry records return to the loop. The loop
retains ownership of LVGL, LCD/touch SPI, map state, commands and telemetry.
See [RTOS-PLAN.md](RTOS-PLAN.md) for exact ownership and the next stages.

Three parallel workstreams reviewed touch behavior, product usability and
RTOS ownership. Their reviews are source-based; they do not represent three
people physically using the device. [PRODUCT-REVIEW.md](PRODUCT-REVIEW.md)
records the recommended next features: trip/history, real battery status,
return-to-start and saved places, then validated alerts and acknowledged SOS.

## Validation and installation

The firmware build passed and all **127 tests** passed, including actual LVGL
event processing, sanitizer-backed tap/calibration checks and MPU task/queue
failure scenarios. The initial application was written to the confirmed active `app0`
slot at `0x10000`; esptool verified the written data hash. Runtime ELF SHA-256
matched the initial built image (superseded by the radio-startup refinement below):

`bef60dbcff2b41d7c8d61ac578690c6435c0bf1959902bb7015bc77d797154ba`

Saved calibration loaded after reboot, the PSRAM test passed, and the MPU task
reported active with zero dropped records. In the initial live window, the
largest touch-sample gap was 31 ms while an MPU worker step reached 148 ms.
The main loop's 240 ms maximum gap included drawing; input still ran between
its display stripes. A longer check then found a 388 ms touch gap between 30 and 35 seconds uptime,
coinciding with deferred recovery Wi-Fi startup. That measurement prevented
accepting the short initial window as the final responsiveness result.

The refinement starts the existing protected recovery AP and network services
before opening the interactive launcher, instead of switching radio modes after
30 seconds of use. Station Wi-Fi still reconnects. AP startup failure remains
visible and is retried only by restart or explicit reconfiguration, avoiding a
blocking retry every loop. Existing network credentials and authentication are
preserved. This means the recovery AP is now available immediately, including
when saved Wi-Fi also connects.

These are observed software timings, not hard guarantees. The final firmware
identity is `c14cfee617240be43876dd4603a6981f55187109dc4b39f15db983c5641266f8`. During the final 60.0-second
check (through more than 70 seconds uptime), the maximum touch-sample gap was
23 ms, both queue-drop counters stayed at zero, USB telemetry remained active,
and map frames advanced. Minimum reported worker stack margin was
1356 bytes. This is a short observed workload,
not a worst-case or long-run guarantee. The full evidence is in the verification JSON.

The user described the touch feel as acceptable and asked to move on to product
suggestions. No formal physical latency measurement was performed. The final
radio refinement preserves the exact UI/touch source used in the seven inspected
screens; SHA-256 source comparisons were checked.

All seven app screens were captured from the device. The first Settings capture
received 239 of 240 USB rows and was rejected; the targeted retry completed.
This was a diagnostic capture transport failure, not a verified LCD fault.

See `../product-touch-verification.json` for final executable results, firmware
identity and device evidence. Rendered screenshots demonstrate layout, not
physical display light output or touch latency. Physical short-tap acceptance
requires the user to touch the panel; software timing counters are not a
contact-to-photon measurement.

## Build and USB workflow

Run from `/home/gamma/esp32-diagnostics`:

```sh
.venv/bin/pio run -d gps-firmware
.venv/bin/python -m unittest discover
```

Before opening the single USB port, stop `esp32-monitor.service` with
`systemctl --user stop esp32-monitor.service`. Restore it after closing the port
with `systemctl --user start esp32-monitor.service`, including on failure.
Keep Wi-Fi/OTA tools separate from a USB session. The installed application slot
must be checked before an application-only write; do not assume another board
boots the same slot. Preserve NVS and the established partition layout.

The previous release archive and matching compiled binary were saved at the
path in `../product-touch-backup-path.txt`. Saved touch calibration and Wi-Fi
credentials live in device NVS and must not be erased for this update.

The server receives this update report and the product/RTOS reviews under
`my projectt/docs/reviews/`. Its separate `firmware/` tree has different pin
assignments and was not replaced by the local firmware. The local downloadable
source/firmware archive is regenerated with `.venv/bin/python make_backup.py`;
private configuration, NVS and sensor logs are excluded.

## Remaining product checks

- Physically repeat brief taps and drag-off cancellation across all controls,
  including during map updates; check a hold produces no repeated actions.
- Verify sunlight readability and enclosure access to the resistive panel.
- Repair/validate the MPU and modem independently; a responsive UI does not
  establish healthy sensors or message delivery.
- Run a longer mixed-workload soak and power-loss/update recovery checks before
  treating this first product build as ready for release.
- A capacitive display assembly is the hardware path to feather-light touch.
  The existing resistive panel still needs sufficient pressure.
