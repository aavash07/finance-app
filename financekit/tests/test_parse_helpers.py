import unittest
from financekit.ocr_engine.normalize import _normalize_merchant_name, _parse_token_to_date

class ParseHelpersTest(unittest.TestCase):
    def test_normalize_merchant_alias(self):
        self.assertEqual(_normalize_merchant_name("walmart supercenter"), "Walmart")
        self.assertEqual(_normalize_merchant_name("Trader joe’s"), "Trader Joe's")
        self.assertEqual(_normalize_merchant_name("  Target  #1234 "), "Target #1234")

    def test_parse_dates(self):
        # basic formats
        from datetime import date
        self.assertEqual(str(_parse_token_to_date("2025-10-07")), "2025-10-07")
        self.assertEqual(str(_parse_token_to_date("10/7/2025")), "2025-10-07")
        self.assertEqual(str(_parse_token_to_date("10-07-2025")), "2025-10-07")
        self.assertEqual(str(_parse_token_to_date("10/07/25")), "2025-10-07")
        # ambiguous D/M/Y when first>12
        self.assertEqual(str(_parse_token_to_date("31/01/2025")), "2025-01-31")
