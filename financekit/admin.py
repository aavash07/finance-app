from django.contrib import admin
from .models import Receipt, ReceiptItem
from .models import DeviceKey, AuditEvent

class ReceiptItemInline(admin.TabularInline):
    model = ReceiptItem
    extra = 0

@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ("id", "merchant", "total", "currency", "created_at")
    search_fields = ("merchant", "raw_text")
    inlines = [ReceiptItemInline]
    
@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "endpoint", "outcome", "device_id", "jti")
    list_filter = ("endpoint", "outcome")
    search_fields = ("device_id", "jti", "request_id")
