# Tiny placeholder you can replace with your OCR pipeline.
# Signature: bytes -> dict
def parse_image_to_json(image_bytes: bytes) -> dict:
    # TODO: replace with your real OCR+parsing.
    # Return a normalized schema so storage/analytics is consistent.
    return {
        "merchant": "Demo Merchant",
        "date": "2025-10-01",
        "currency": "USD",
        "total": 12.34,
        "items": [
            {"desc": "Coffee", "qty": 1, "price": 3.50},
            {"desc": "Bagel", "qty": 1, "price": 2.80},
        ],
    }
