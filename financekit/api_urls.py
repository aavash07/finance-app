from django.urls import path
from django.conf import settings
from .views import (
    ServerPubKeyView,
    DeviceRegisterView,
    ProcessDecryptView,
    DevCreateEncryptedReceiptView,
    IngestReceiptView,
    AnalyticsSpendView,
    DevMintTokenView,          # NEW
    DevWrapDekView,            # NEW
    RegisterView,
)
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
    path("crypto/server-public-key", ServerPubKeyView.as_view()),
    path("device/register", DeviceRegisterView.as_view()),
    path("decrypt/process", ProcessDecryptView.as_view()),
    path("dev/create-receipt", DevCreateEncryptedReceiptView.as_view()),  # existing dev helper
    path("ingest/receipt", IngestReceiptView.as_view()),
    path("analytics/spend", AnalyticsSpendView.as_view()),
    # Auth endpoints
    path("auth/register", RegisterView.as_view()),
    path("auth/token", TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path("auth/token/refresh", TokenRefreshView.as_view(), name='token_refresh'),
]

# Gate dev-only helpers behind a setting (on by default in dev)
if getattr(settings, "ALLOW_DEV_ENDPOINTS", True):
    urlpatterns += [
        path("dev/mint-token", DevMintTokenView.as_view()),
        path("dev/wrap-dek", DevWrapDekView.as_view()),
    ]
