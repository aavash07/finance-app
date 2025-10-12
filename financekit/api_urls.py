# financekit/api_urls.py

from django.urls import path
from .views import (
    ServerPubKeyView,
    DeviceRegisterView,
    ProcessDecryptView,
    DevCreateEncryptedReceiptView,
    IngestReceiptView,
    DevMintTokenView,          # NEW
    DevWrapDekView,            # NEW
)

urlpatterns = [
    path("crypto/server-public-key", ServerPubKeyView.as_view()),
    path("device/register", DeviceRegisterView.as_view()),
    path("decrypt/process", ProcessDecryptView.as_view()),
    path("dev/create-receipt", DevCreateEncryptedReceiptView.as_view()),  # existing dev helper
    path("ingest/receipt", IngestReceiptView.as_view()),
    # NEW dev-only helpers
    path("dev/mint-token", DevMintTokenView.as_view()),
    path("dev/wrap-dek", DevWrapDekView.as_view()),
]
