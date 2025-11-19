from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ("financekit", "0003_receipt_body_ct_receipt_body_nonce_receipt_body_tag_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("device_id", models.CharField(blank=True, default="", max_length=128)),
                ("jti", models.CharField(blank=True, default="", max_length=64)),
                ("endpoint", models.CharField(max_length=64)),
                ("outcome", models.CharField(max_length=32)),
                ("targets", models.JSONField(blank=True, default=list)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("request_id", models.CharField(blank=True, default="", max_length=36)),
                ("extra", models.JSONField(blank=True, default=dict)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["created_at"], name="financekit_created_ae_idx"),
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["user", "created_at"], name="financekit_user_created_ae_idx"),
        ),
        migrations.AddIndex(
            model_name="auditevent",
            index=models.Index(fields=["endpoint", "created_at"], name="financekit_ep_created_ae_idx"),
        ),
    ]
