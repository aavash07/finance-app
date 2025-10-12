from django.contrib import admin
from .models import Receipt, ReceiptItem

class ReceiptItemInline(admin.TabularInline):
    model = ReceiptItem
    extra = 0

@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ("id", "merchant", "total", "currency", "created_at")
    search_fields = ("merchant", "raw_text")
    inlines = [ReceiptItemInline]
