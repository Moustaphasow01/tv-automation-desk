"""Extract review evidence from an official PDF (offline tooling; requires pypdf).

Usage: python extract_grains_calendar_pdf_evidence.py document.pdf metadata.json
The output is tied to the original bytes; it is not a historical receipt.
"""
import hashlib
import json
import sys
from datetime import timezone
from pathlib import Path
from pypdf import PdfReader


def main():
    source, output = map(Path, sys.argv[1:3])
    reader = PdfReader(source)
    modified = reader.metadata.modification_date
    if modified is None or modified.tzinfo is None:
        raise ValueError("CALENDAR_PDF_MODIFICATION_TIME_UNPROVEN")
    evidence = {
        "schemaVersion": "grains_calendar_pdf_metadata_v1",
        "documentSha256": "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest(),
        "documentModifiedAtUtc": modified.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "originalModDate": str(reader.metadata.get("/ModDate")),
        "source": "PDF document metadata, not a collection timestamp",
    }
    with output.open("x", encoding="utf8") as stream:
        json.dump(evidence, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
