from __future__ import annotations
from financekit.ocr_engine import run as engine_run

def parse_image_to_json(image_bytes: bytes, user=None) -> dict:
    return engine_run(image_bytes, user=user)
