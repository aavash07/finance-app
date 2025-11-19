from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ("financekit", "0006_receipt_fees_tips"),
    ]

    operations = [
        migrations.AddField(
            model_name="receiptitem",
            name="category",
            field=models.CharField(max_length=64, blank=True, default=""),
        ),
    ]
