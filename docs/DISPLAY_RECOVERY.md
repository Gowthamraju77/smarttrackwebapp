# Connected display recovery — 2026-11-04

## Resume checkpoint

The user resumed session `01a1a534-c191-7510-9a52-e04e49a20d7c` and identified
an Omnirush server at `http://192.168.1.34:3000`, with a device connected there.
Use that server to inspect the latest display implementation before changing
firmware. The Windows workspace currently enumerates no serial ports. The
server answers ping, but TCP port 3000 currently refuses the connection; its
device inventory, source changes, and running firmware remain unverified.

An independent offline review verified the saved GPIO5 patch: exactly one code
byte changes, with checksum/hash updates; the original and patched images and
rollback artifacts match their receipts. Only sectors `0x033000` and `0x0F3000`
differ. These artifacts still describe the previously captured firmware and
have not been flashed. The embedded ELF identifier is unchanged by the patch,
so it cannot prove a fresh device matches the original. Require an exact
application/sector comparison, current partition identity, and disabled secure
boot/flash encryption before considering this patch for a connected device.

The remainder records the earlier direct-USB investigation.

The user reported a faintly lit but otherwise dark display. The investigation
uses the already supplied TFT wiring. It has not established a wiring fault or
confirmed visible pixels. No firmware was written or erased.

## Connected firmware and wiring

- Port: COM14, 115200 baud. Serial probes use DTR=false and RTS=false.
- TFT: SPI SCK12 / MOSI11 / MISO13, CS10, DC9, RST8, backlight5,
  peripheral power21. The running firmware reports an ILI9341 profile.
- Actual GPS input: RX39 at 9600 baud. This differs from the older repository
  firmware's RX6 contract; do not replace the running sketch with that older
  firmware as a display fix.
- Actual IMU: MPU-6500, I2C address 0x68, SDA17 / SCL18. Its diagnostic metadata
  reports 8192 counts/g, 65.5 counts/(degree/s), 50 Hz output and zero errors.
- Running partition: `app0`, address `0x10000`.
- Reported application ELF SHA-256:
  `d3bb4a806332cd6e84c4296495772bf9d8110cc28991db785a7d16a9731b3f7f`.
- Binary source references point to `/home/gamma/esp32-diagnostics/.platformio/`.
  A matching editable source was not found in the targeted local project,
  Arduino, Documents, Downloads, Desktop, OneDrive, or temporary artifacts.

## Preservation before changing firmware

Installed esptool 5.3.1 detected 16 MB of flash. A single full-flash read stopped
with `Packet content transfer stopped` after approximately 3.44 MB. Bounded
1 MiB reads saved the first three chunks; the fourth transfer also stopped.
Esptool then successfully returned the existing firmware to normal operation
using `run` followed by a hard reset. No flash-write command was used.

The preserved, contiguous **partial** backup is:

`.local/hardware/flashbackup-20261104-130341/esp32s3-COM14-first-3MiB.bin`

- Length: 3,145,728 bytes.
- Address coverage: `0x000000` through `0x2FFFFF`, inclusive.
- SHA-256: `b603af475fee50ee0181d8e562c68f2199010ee6eed68356954711060dc4d123`.
- Its `app0` ELF identifier matches the running firmware identifier above.
- Individual chunks, logs and receipts remain in the same ignored `.local`
  folder. Raw firmware bytes are not included in this document or deployment.

This is **not a complete 16 MB backup** and must not be represented as a complete
restore image. No reflash is authorized by this investigation's current state.

## Runtime display commands recovered from the application

Commands are ASCII lines terminated with LF. They were identified from the
preserved application string table, rather than guessed from the older sketches.

| Command | Evidence and purpose |
| --- | --- |
| `DISPLAY_TEST` | Executed successfully; reports four filled red/green/blue/yellow quadrants and a 320×240 border. Holds the diagnostic view. |
| `DISPLAY_REGS` | Executed successfully; reports controller-register readbacks and configured geometry. |
| `DISPLAY_WIDTH_TEST` | Present in the application; reports eight 40-pixel bands across columns 0–319. Not executed during the initial check. |
| `DISPLAY_LIVE` | Present in the application with response `DISPLAY_LIVE resumed`; intended to restore live sensor rendering after the test. |

`HELP` returned `COMMAND_UNKNOWN`. No separate backlight, GPIO or display-power
command was found. The firmware also supports the `TFT_MAP_BEGIN`,
`TFT_MAP_DATA` and `TFT_MAP_END` frame protocol and reports 288×144 indexed frames
of 41,984 bytes. That protocol is separate from the display test commands.

## Initial test result

After normal reboot, `DISPLAY_TEST` and `DISPLAY_REGS` were accepted. The device
reported:

```text
DISPLAY_INIT_SENT profile=ILI9341 landscape=320x240 buffered=true SCK=12 MOSI=11 MISO=13 CS=10 DC=9 RST=8 BL=5 POWER=21
DISPLAY_CALIBRATION_PATTERN 320x240 landscape filled_quadrants=red,green,blue,yellow border=0..319,0..239
```

During the following six seconds, 12 RMC/GGA lines and 281 MPU samples arrived.
Periodic live `DISPLAY_RENDER` lines stopped while the diagnostic view was held.
This establishes that the commands ran while GPS and IMU acquisition continued;
it does not establish that the panel visibly displayed the pattern.

Register readbacks included MADCTL `48`, pixel-format readback `05`, and varying
all-zero/all-FF D3 ID reads. The firmware explicitly warns that these ID reads
do not identify the controller or prove a panel fault. Do not infer a wiring or
controller diagnosis from these values alone.

At this checkpoint, COM14 is closed and released, the diagnostic pattern is
held, and the user's visible observation is pending. Restore `DISPLAY_LIVE`
after that observation, then verify fresh GPS/IMU data and display-render status.
