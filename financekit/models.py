from django.db import models
from django.conf import settings

class DeviceKey(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device_id = models.CharField(max_length=128, db_index=True)
    public_key_b64 = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

class Receipt(models.Model):
    # Use the string reference to avoid get_user_model import at import time
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    year      = models.IntegerField(null=True, blank=True)
    month     = models.IntegerField(null=True, blank=True)
    category  = models.CharField(max_length=64, null=True, blank=True)

    # Encrypted payload (AES-GCM)
    body_nonce = models.BinaryField(null=True, blank=True)
    body_ct    = models.BinaryField(null=True, blank=True)
    body_tag   = models.BinaryField(null=True, blank=True)

    # Optional derived/plain fields
    merchant = models.CharField(max_length=255, blank=True, default="")
    date_str = models.CharField(max_length=32, blank=True, default="")
    currency = models.CharField(max_length=8, blank=True, default="USD")
    total    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    raw_text = models.TextField(blank=True, default="")
    ocr_json = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.merchant or 'Receipt'} • {self.total} {self.currency}"

class GrantJTI(models.Model):
    jti = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    device_id = models.CharField(max_length=128)
    used_at = models.DateTimeField(auto_now=True)

class ReceiptItem(models.Model):
    receipt = models.ForeignKey(Receipt, on_delete=models.CASCADE, related_name="items")
    desc = models.CharField(max_length=512)
    qty = models.DecimalField(max_digits=12, decimal_places=3, default=1)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.desc} ({self.qty} × {self.price})"
