import json
from django.test import TestCase, Client
from django.contrib.auth.models import User
from financekit.models import Receipt


class ReceiptListFiltersTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("alice", password="pass1234")
        self.c = Client()
        self.c.login(username="alice", password="pass1234")
        # seed data
        for i in range(1, 6):
            Receipt.objects.create(
                user=self.u,
                year=2025,
                month=10 if i % 2 else 9,
                category="Food" if i % 2 else "Other",
                merchant=f"Store {i}",
                total=10 * i,
            )

    def test_filter_month(self):
        r = self.c.get("/api/v1/receipts?month=2025-10")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        # paginated response shape
        self.assertIn("results", data)
        self.assertTrue(all(x["merchant"].startswith("Store") for x in data["results"]))

    def test_filter_category_and_merchant(self):
        r = self.c.get("/api/v1/receipts?category=Food&merchant=Store")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("results", data)
        self.assertGreaterEqual(len(data["results"]), 1)
