import json
from django.test import TestCase, Client
from django.contrib.auth.models import User
from financekit.models import Receipt
from decimal import Decimal

class AnalyticsSpendTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("bob", password="pass1234")
        self.c = Client()
        self.c.login(username="bob", password="pass1234")
        # Seed receipts across two months
        def mk(mo, day, cat, merch, amt):
            Receipt.objects.create(
                user=self.u,
                year=2025,
                month=mo,
                category=cat,
                merchant=merch,
                date_str=f"2025-{mo:02d}-{day:02d}",
                total=Decimal(str(amt)),
            )
        mk(10, 1, "Food", "Cafe A", 12.50)
        mk(10, 2, "Food", "Cafe A", 7.25)
        mk(10, 2, "Grocery", "Market B", 40.00)
        mk(9,  28, "Other", "Shop C", 20.00)

    def test_month_totals(self):
        r = self.c.get("/api/v1/analytics/spend?month=2025-10")
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual(data["month"], "2025-10")
        # total in October: 12.50 + 7.25 + 40.00 = 59.75
        self.assertEqual(data["total"], "59.75")
        self.assertTrue(any(x["merchant"] == "Cafe A" for x in data["top_merchants"]))
        self.assertTrue(any(d["date"] == "2025-10-02" for d in data["daily"]))

    def test_category_filter(self):
        r = self.c.get("/api/v1/analytics/spend?month=2025-10&category=Food")
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        # total in Food for October: 12.50 + 7.25 = 19.75
        self.assertEqual(data["total"], "19.75")
