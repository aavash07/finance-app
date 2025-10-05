# devtools/ocr_try_text.py (optional)
import sys, pathlib, json, pytesseract
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pathlib import Path
from financekit.ocr_adapter import parse_image_to_json
from financekit.ocr_engine.reader import load_thresh_from_bytes, ocr_text

p = Path(sys.argv[1])
b = p.read_bytes()
bin_img = load_thresh_from_bytes(b)
print("Tesseract version:", pytesseract.get_tesseract_version())
txt = ocr_text(bin_img)
print("Text from image:\n", txt)
print(json.dumps(parse_image_to_json(b), indent=2, ensure_ascii=False))
