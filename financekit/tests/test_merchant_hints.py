from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from financekit.models import MerchantHint

class MerchantHintsTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('u1', password='pass1234')
        self.c = APIClient()
        self.c.login(username='u1', password='pass1234')

    def test_create_and_list_hints(self):
        r = self.c.post('/api/v1/merchants/hints', {'merchant': 'Starbucks'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.content)
        self.assertEqual(r.json().get('merchant'), 'Starbucks')
        self.assertEqual(r.json().get('count'), 1)

        r2 = self.c.post('/api/v1/merchants/hints', {'merchant': 'Starbucks'}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED, r2.content)
        self.assertEqual(r2.json().get('count'), 2)

        r3 = self.c.get('/api/v1/merchants/hints')
        self.assertEqual(r3.status_code, status.HTTP_200_OK, r3.content)
        body = r3.json()
        hints = body.get('hints')
        self.assertTrue(any(h['merchant'] == 'Starbucks' and h['count'] == 2 for h in hints))
        self.assertEqual(MerchantHint.objects.filter(user=self.user, merchant='Starbucks').first().count, 2)

    def test_validation_requires_merchant(self):
        r = self.c.post('/api/v1/merchants/hints', {'merchant': ''}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('merchant', r.json().get('detail', 'merchant required'))
