__all__ = ["run"]

def run(image_bytes: bytes) -> dict:
	# Lazy import to avoid importing heavy deps (cv2) at module import time
	from .engine import run as _run
	return _run(image_bytes)
