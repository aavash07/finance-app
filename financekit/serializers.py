from rest_framework import serializers
from .models import Receipt, ReceiptItem, MerchantHint

class DeviceRegisterSerializer(serializers.Serializer):
    device_id = serializers.CharField()
    public_key_b64 = serializers.CharField()

class ProcessGrantSerializer(serializers.Serializer):
    token = serializers.CharField()
    dek_wrap_srv = serializers.CharField()
    targets = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)

class DevCreateReceiptSerializer(serializers.Serializer):
    # dev helper: insert an already-encrypted receipt row for testing
    user_id = serializers.IntegerField()
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    category = serializers.CharField()
    body_nonce_b64 = serializers.CharField()
    body_ct_b64 = serializers.CharField()
    body_tag_b64 = serializers.CharField()

class IngestReceiptSerializer(serializers.Serializer):
    # short-lived grant (EdDSA JWT) + server-wrapped DEK (RSA-OAEP)
    token = serializers.CharField()
    dek_wrap_srv = serializers.CharField()
    # metadata
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    category = serializers.CharField()
    # image file
    image = serializers.ImageField()
    
class ReceiptItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)  # allow omission for new items
    class Meta:
        model = ReceiptItem
        fields = ("id", "desc", "qty", "price")

class ReceiptSerializer(serializers.ModelSerializer):
    items = ReceiptItemSerializer(many=True, required=False)
    class Meta:
        model = Receipt
        fields = (
            "id",
            "merchant",
            "date_str",
            "currency",
            "category",
            "total",
            "subtotal",
            "tax_total",
            "discount_total",
            "fees_total",
            "tip_total",
            "items",
            "created_at",
        )
        read_only_fields = ("created_at",)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        has_items = bool(data.get("items"))
        if not has_items:
            ocr = getattr(instance, "ocr_json", {}) or {}
            raw_items = list(ocr.get("items") or [])
            norm = []
            for it in raw_items:
                desc = str((it.get("desc") or "")).strip()
                if not desc:
                    continue
                qty = it.get("qty", 1)
                price = it.get("price", 0)
                norm.append({"id": None, "desc": desc, "qty": str(qty), "price": str(price)})
            if norm:
                data["items"] = norm
        return data

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        # Assign scalar fields
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items_data is not None:
            # Full replacement strategy for simplicity
            instance.items.all().delete()
            for it in items_data:
                ReceiptItem.objects.create(
                    receipt=instance,
                    desc=str(it.get("desc", ""))[:512],
                    qty=it.get("qty", 1) or 1,
                    price=it.get("price", 0) or 0,
                )
        return instance


class DevMintTokenSerializer(serializers.Serializer):
    device_id = serializers.CharField(max_length=128)
    scope = serializers.ListField(
        child=serializers.CharField(max_length=64),
        allow_empty=False,
    )
    ttl_seconds = serializers.IntegerField(min_value=30, max_value=3600, default=300)
    # optional: targets to embed in JWT for decrypt/process demo
    targets = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
        default=list,
    )

class DevWrapDekSerializer(serializers.Serializer):
    # nothing required; included for symmetry / future params
    dummy = serializers.BooleanField(required=False, default=False)


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=6)
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_username(self, value):
        from django.contrib.auth.models import User
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already taken")
        return value

    def create(self, validated_data):
        from django.contrib.auth.models import User
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )
        return user


class MerchantHintSerializer(serializers.ModelSerializer):
    class Meta:
        model = MerchantHint
        fields = ("merchant", "count", "last_seen")