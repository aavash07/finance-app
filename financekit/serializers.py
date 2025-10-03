from rest_framework import serializers

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
