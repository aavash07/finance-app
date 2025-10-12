from django.contrib import admin
from django.urls import path, include
from financekit.views import ReceiptListView, ReceiptDetailView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("financekit.api_urls")),
    path("api/v1/receipts", ReceiptListView.as_view()),
    path("api/v1/receipts/<int:pk>", ReceiptDetailView.as_view()),
]
