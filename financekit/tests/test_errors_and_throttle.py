from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APIClient


class ErrorEnvelopeTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("u1", password="pass1234")
        self.c = APIClient()

    def test_auth_required_error_is_wrapped(self):
        # No auth to a protected endpoint -> 401 with our envelope
        r = self.c.get("/api/v1/crypto/server-public-key")
        self.assertEqual(r.status_code, status.HTTP_401_UNAUTHORIZED)
        body = r.json()
        self.assertIn("code", body)
        self.assertIn("detail", body)


class ThrottleTest(TestCase):
    @override_settings(REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": [
            "rest_framework.authentication.BasicAuthentication",
            "rest_framework.authentication.SessionAuthentication",
        ],
        "DEFAULT_PERMISSION_CLASSES": [
            "rest_framework.permissions.IsAuthenticated",
        ],
        "EXCEPTION_HANDLER": "financekit.exceptions.exception_handler",
        "DEFAULT_THROTTLE_CLASSES": [
            "rest_framework.throttling.ScopedRateThrottle",
        ],
        "DEFAULT_THROTTLE_RATES": {
            "user": "1/min",
            "decrypt": "100/min",
        },
    })
    def test_decrypt_rate_limit(self):
        User.objects.create_user("u2", password="pass1234")
        c = APIClient()
        c.login(username="u2", password="pass1234")
        # Ensure IP is set so ScopedRateThrottle can key by ident
        c.defaults["REMOTE_ADDR"] = "127.0.0.1"
        body = {"token": "a.b.c", "dek_wrap_srv": "x", "targets": [1]}
        c.post("/api/v1/decrypt/process", data=body, format="json")
        r2 = c.post("/api/v1/decrypt/process", data=body, format="json")
        self.assertEqual(r2.status_code, status.HTTP_429_TOO_MANY_REQUESTS, r2.content)
        body = r2.json()
        self.assertEqual(body.get("code"), "rate_limited")
