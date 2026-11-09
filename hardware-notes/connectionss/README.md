# SmartTrack connectionss folder

This folder contains the detailed connection deliverable for the SmartTrack
hardware build.

## Main deliverables

- `SmartTrack_Connections_Detailed.pdf` — seven-page detailed connection and
  staged bring-up manual.
- `SmartTrack_Connections_Detailed.md` — editable source used to regenerate
  the PDF.
- `Connection_Verification_Report.md` — independent creator/auditor summary,
  unresolved firmware gaps, and hardware qualification limits.
- `create_connections_pdf.py` — dependency-free PDF generator.

## Regenerate the PDF

From the workspace root:

```powershell
python connectionss\create_connections_pdf.py
```

The manual is based on the supplied `CONNECTIONS_PER_COMPONENT.pdf` and the
SmartTrack project pin contract. It explicitly marks source-derived facts,
firmware-defined behavior, reserved wiring, and bench-required verification.
Do not treat it as a substitute for continuity, voltage, current, thermal,
RF, or end-to-end hardware testing.
