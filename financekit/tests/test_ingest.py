import base64, json, time, uuid, os, io
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from nacl.signing import SigningKey
from nacl.encoding import Base64Encoder
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding
from PIL import Image


def b64url(b): import base64 as b64m; return b64m.urlsafe_b64encode(b).decode().rstrip("=")

def _tiny_png() -> SimpleUploadedFile:
        img = Image.new("RGB", (1, 1), (255, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return SimpleUploadedFile("tiny.png", buf.getvalue(), content_type="image/png")

class IngestTest(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("tester", password="pass1234")
        self.c = Client()
        self.c.login(username="tester", password="pass1234")
        from django.conf import settings
        with open(settings.SERVER_RSA_PUB_PATH, "rb") as f:
            self.pub = serialization.load_pem_public_key(f.read())
        self.sk = SigningKey.generate()
        self.vk_b64 = self.sk.verify_key.encode(encoder=Base64Encoder).decode()
        # register device
        self.c.post("/api/v1/device/register",
            data=json.dumps({"device_id":"dev-1","public_key_b64":self.vk_b64}),
            content_type="application/json")

    def _jwt_ingest(self):
        now = int(time.time())
        header = {"alg":"EdDSA","typ":"JWT","kid":"dev-1"}
        payload = {"sub":str(self.u.id),"device_id":"dev-1","scope":["receipt:ingest"],
                   "iat":now,"nbf":now-5,"exp":now+120,"jti":str(uuid.uuid4())}
        H = b64url(json.dumps(header,separators=(",",":")).encode())
        P = b64url(json.dumps(payload,separators=(",",":")).encode())
        S = self.sk.sign((H+"."+P).encode()).signature
        return f"{H}.{P}.{b64url(S)}"

    def _wrap_dek(self):
        dek = os.urandom(32)
        from base64 import b64encode
        wrap = b64encode(self.pub.encrypt(
            dek,
            asy_padding.OAEP(mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
                             algorithm=hashes.SHA256(), label=None)
        )).decode()
        return dek, wrap

    def test_ingest_flow(self):
        jwt = self._jwt_ingest()
        dek, wrap = self._wrap_dek()
        img = _tiny_png()

        resp = self.c.post(
            "/api/v1/ingest/receipt",
            data={
                "token": jwt,
                "dek_wrap_srv": wrap,
                "year": 2025,
                "month": 10,
                "category": "Food",
                "image": img,
            }
        )
        self.assertEqual(resp.status_code, 200, resp.content)
