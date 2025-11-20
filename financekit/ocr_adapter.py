from __future__ import annotations
from financekit.ocr_engine import run as engine_run

def parse_image_to_json(image_bytes: bytes) -> dict:
    """Thin wrapper around OCR engine for backward compatibility across image versions."""
    return engine_run(image_bytes)
