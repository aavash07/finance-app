from django.test import TestCase, Client, override_settings
from django.contrib.auth.models import User


class DevGateTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin", password="pass1234", is_staff=True, is_superuser=True)
        self.c = Client()
        self.c.login(username="admin", password="pass1234")

    @override_settings(ALLOW_DEV_ENDPOINTS=False)
    def test_dev_mint_token_404_when_disabled(self):
        r = self.c.post("/api/v1/dev/mint-token", data={"device_id":"x","scope":["receipt:ingest"],"ttl_seconds":60}, content_type="application/json")
        self.assertEqual(r.status_code, 404, r.content)