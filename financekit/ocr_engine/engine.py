from __future__ import annotations
from .reader import load_thresh_from_bytes, ocr_text
from .normalize import normalize_text_to_schema

def run(image_bytes: bytes) -> dict:
    """
    Public entrypoint: identical behavior to your old external pipeline.
    """
    bin_img = load_thresh_from_bytes(image_bytes)
    text = ocr_text(bin_img)
    return normalize_text_to_schema(text)
