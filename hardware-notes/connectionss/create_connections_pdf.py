"""Create a dependency-free PDF from SmartTrack_Connections_Detailed.md.

This intentionally uses only the Python standard library so the connection
manual can be regenerated on an offline engineering workstation.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "SmartTrack_Connections_Detailed.md"
OUTPUT = ROOT / "SmartTrack_Connections_Detailed.pdf"

PAGE_W, PAGE_H = 612, 792
MARGIN_X = 42
TOP = 742
BOTTOM = 44
CONTENT_W = PAGE_W - 2 * MARGIN_X

REPLACEMENTS = {
    "—": "-", "–": "-", "→": "->", "←": "<-", "≥": ">=", "≤": "<=",
    "²": "2", "³": "3", "µ": "u", "Ω": "ohm", "·": "-", "×": "x",
    "°": " deg", "✓": "[x]", "✗": "[!]", "`": "",
    "─": "-", "━": "-", "═": "=", "│": "|", "║": "|",
}


def ascii_text(text: str) -> str:
    for source, target in REPLACEMENTS.items():
        text = text.replace(source, target)
    return text.encode("latin-1", "replace").decode("latin-1")


def wrap(text: str, width: int) -> list[str]:
    text = ascii_text(text.rstrip())
    if not text:
        return [""]
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        if len(word) > width:
            if line:
                lines.append(line)
                line = ""
            while len(word) > width:
                lines.append(word[:width])
                word = word[width:]
            line = word
        elif not line:
            line = word
        elif len(line) + 1 + len(word) <= width:
            line += " " + word
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def parse_markdown(path: Path) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    in_code = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            blocks.append(("code", line))
        elif line.startswith("# "):
            blocks.append(("title", line[2:]))
        elif line.startswith("## "):
            blocks.append(("h2", line[3:]))
        elif line.startswith("### "):
            blocks.append(("h3", line[4:]))
        elif line.startswith("|"):
            if set(line.replace("|", "").replace("-", "").replace(":", "").strip()) == set():
                continue
            blocks.append(("table", line.replace("|", "  ")))
        elif line.startswith("- "):
            blocks.append(("body", "- " + line[2:]))
        elif line.strip():
            blocks.append(("body", line))
        else:
            blocks.append(("space", ""))
    return blocks


def esc_pdf(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pages(blocks: list[tuple[str, str]]) -> list[list[tuple[str, str, float, float]]]:
    pages: list[list[tuple[str, str, float, float]]] = [[]]
    y = TOP

    def need(height: float) -> None:
        nonlocal y
        if y - height < BOTTOM:
            pages.append([])
            y = TOP

    for kind, value in blocks:
        if kind == "space":
            y -= 7
            continue
        if kind == "title":
            need(30)
            pages[-1].append(("title", value, MARGIN_X, y))
            y -= 30
        elif kind == "h2":
            need(24)
            pages[-1].append(("h2", value, MARGIN_X, y))
            y -= 22
        elif kind == "h3":
            need(19)
            pages[-1].append(("h3", value, MARGIN_X, y))
            y -= 18
        elif kind == "code":
            for line in wrap(value, 92):
                need(12)
                pages[-1].append(("code", line, MARGIN_X + 10, y))
                y -= 11
        elif kind == "table":
            for line in wrap(value, 92):
                need(12)
                pages[-1].append(("table", line, MARGIN_X, y))
                y -= 11
        else:
            for line in wrap(value, 96):
                need(14)
                pages[-1].append(("body", line, MARGIN_X, y))
                y -= 13
    return pages


def stream_for(page: list[tuple[str, str, float, float]], page_number: int, total: int) -> bytes:
    commands = ["BT"]
    for kind, text, x, y in page:
        text = ascii_text(text)
        if kind == "title":
            font, size, color = "/F2", 18, "0.08 0.16 0.25"
        elif kind == "h2":
            font, size, color = "/F2", 12, "0.42 0.20 0.08"
        elif kind == "h3":
            font, size, color = "/F2", 10, "0.12 0.35 0.38"
        elif kind == "code":
            font, size, color = "/F3", 7.3, "0.12 0.18 0.23"
        elif kind == "table":
            font, size, color = "/F3", 6.5, "0.12 0.18 0.23"
        else:
            font, size, color = "/F1", 8.5, "0.12 0.16 0.22"
        commands.extend([f"{color} rg", f"{font} {size} Tf", f"1 0 0 1 {x:.1f} {y:.1f} Tm", f"({esc_pdf(text)}) Tj"])
    commands.extend(["ET", "BT", "/F1 7 Tf", "0.38 0.43 0.48 rg", f"1 0 0 1 {MARGIN_X} 24 Tm", f"(SmartTrack connection manual  |  Page {page_number} of {total}) Tj", "ET"])
    return ("\n".join(commands) + "\n").encode("latin-1")


def create_pdf() -> None:
    pages = build_pages(parse_markdown(SOURCE))
    objects: list[bytes] = []

    def add(value: bytes) -> int:
        objects.append(value)
        return len(objects)

    catalog = add(b"")
    pages_obj = add(b"")
    font_regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
    font_mono = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    page_refs: list[int] = []
    content_refs: list[int] = []
    for index, page in enumerate(pages, start=1):
        content = stream_for(page, index, len(pages))
        content_ref = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream")
        page_ref = add(b"")
        content_refs.append(content_ref)
        page_refs.append(page_ref)
    objects[catalog - 1] = f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode()
    objects[pages_obj - 1] = (f"<< /Type /Pages /Kids [{' '.join(f'{ref} 0 R' for ref in page_refs)}] /Count {len(page_refs)} >>").encode()
    for page_ref, content_ref in zip(page_refs, content_refs):
        objects[page_ref - 1] = (f"<< /Type /Page /Parent {pages_obj} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R /F3 {font_mono} 0 R >> >> /Contents {content_ref} 0 R >>").encode()

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode())
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    output.extend("".join(f"{offset:010d} 00000 n \n" for offset in offsets[1:]).encode())
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    OUTPUT.write_bytes(output)
    print(f"created {OUTPUT} ({len(pages)} pages, {len(output)} bytes)")


if __name__ == "__main__":
    create_pdf()
