from django.urls import path
from .views import (
    ServerPubKeyView,
    DeviceRegisterView,
    ProcessDecryptView,
    DevCreateEncryptedReceiptView,
    IngestReceiptView,
)

urlpatterns = [
    path("crypto/server-public-key", ServerPubKeyView.as_view()),
    path("device/register", DeviceRegisterView.as_view()),
    path("decrypt/process", ProcessDecryptView.as_view()),
    path("dev/create-receipt", DevCreateEncryptedReceiptView.as_view()),  # dev-only helper
    path("ingest/receipt", IngestReceiptView.as_view()),
]
