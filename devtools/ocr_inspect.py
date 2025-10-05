import sys, pathlib, json
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pathlib import Path
from financekit.ocr_engine.preprocess import decode_image, remove_borders, enhance, binarize, deskew
from financekit.ocr_engine.ocr import orient, ocr_lines

p = Path(sys.argv[1])
b = p.read_bytes()

ok, img = decode_image(b)
if not ok:
    from PIL import Image
    import numpy as np, io, cv2
    pil = Image.open(io.BytesIO(b)).convert("RGB")
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

img = remove_borders(img)
img = enhance(img)
gray = binarize(img)
gray = deskew(gray)
gray = orient(gray)

lines = ocr_lines(gray)
for i, L in enumerate(lines[:20], 1):
    print(f"{i:02d}  conf={L['conf']:.1f}  top={L['top']:4}  text={L['text']}")
