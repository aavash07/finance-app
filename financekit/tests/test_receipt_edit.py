from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from financekit.models import Receipt, ReceiptItem

class ReceiptEditTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('u1', password='pass1234')
        self.c = APIClient()
        self.c.login(username='u1', password='pass1234')
        self.receipt = Receipt.objects.create(user=self.user, year=2025, month=11, category='food', merchant='Old Merch', date_str='2025-11-19', currency='USD', total=10.00)

    def test_patch_receipt(self):
        r = self.c.patch(f'/api/v1/receipts/{self.receipt.id}', {'merchant': 'New Merchant', 'total': '12.34'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.content)
        body = r.json()
        self.assertEqual(body.get('merchant'), 'New Merchant')
        self.assertEqual(body.get('total'), '12.34')
        self.receipt.refresh_from_db()
        self.assertEqual(str(self.receipt.total), '12.34')

    def test_reject_invalid_total(self):
        r = self.c.patch(f'/api/v1/receipts/{self.receipt.id}', {'total': 'abc'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_full_edit_with_items_and_breakdown(self):
        payload = {
            'merchant': 'Store ABC',
            'category': 'groceries',
            'currency': 'USD',
            'date_str': '2025-11-20',
            'subtotal': '8.00',
            'tax_total': '1.00',
            'fees_total': '0.50',
            'tip_total': '0.50',
            'discount_total': '0.00',
            'total': '10.00',
            'items': [
                {'desc': 'Apples', 'qty': '2', 'price': '3.00'},
                {'desc': 'Bananas', 'qty': '1', 'price': '2.00'}
            ]
        }
        r = self.c.patch(f'/api/v1/receipts/{self.receipt.id}', payload, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK, r.content)
        body = r.json()
        self.assertEqual(body.get('merchant'), 'Store ABC')
        self.assertEqual(body.get('subtotal'), '8.00')
        self.assertEqual(len(body.get('items', [])), 2)
        self.receipt.refresh_from_db()
        self.assertEqual(self.receipt.items.count(), 2)
        self.assertEqual(str(self.receipt.tip_total), '0.50')

    def test_invalid_item_price(self):
        payload = {
            'items': [ {'desc': 'Bad', 'qty': '1', 'price': 'xyz'} ]
        }
        r = self.c.patch(f'/api/v1/receipts/{self.receipt.id}', payload, format='json')
        # DRF will raise validation error on Decimal parsing
        self.assertEqual(r.status_code, 400)
