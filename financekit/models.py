from django.db import models
from django.conf import settings

class DeviceKey(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device_id = models.CharField(max_length=128, db_index=True)   # used as JWT kid
    # base64 public key for Ed25519
    public_key_b64 = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

class Receipt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # AEAD ciphertext split or concatenated; here we split
    body_ct = models.BinaryField()
    body_nonce = models.BinaryField()
    body_tag = models.BinaryField()
    # optional “shadow” analytics
    year = models.SmallIntegerField()
    month = models.SmallIntegerField()
    category = models.CharField(max_length=64, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

class GrantJTI(models.Model):
    jti = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device_id = models.CharField(max_length=128)
    used_at = models.DateTimeField(auto_now=True)
