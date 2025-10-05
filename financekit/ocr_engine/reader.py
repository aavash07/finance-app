from __future__ import annotations
import os
import cv2
import pytesseract
import numpy as np

# Optional override for tesseract binary:
#  - Windows: setx TESSERACT_CMD "C:\Program Files\Tesseract-OCR\tesseract.exe"
#  - Linux:   export TESSERACT_CMD="/usr/bin/tesseract"
if os.getenv("TESSERACT_CMD"):
    pytesseract.pytesseract.tesseract_cmd = os.getenv("TESSERACT_CMD")

def load_thresh_from_bytes(image_bytes: bytes):
    """BGR -> gray -> THRESH_BINARY(150) (same as external script)."""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    return thresh

def ocr_text(bin_img) -> str:
    if bin_img is None:
        return ""
    try:
        return pytesseract.image_to_string(bin_img)
    except Exception:
        return ""
