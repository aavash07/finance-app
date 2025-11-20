from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ("financekit", "0009_merchanthint"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="receiptitem",
            name="category",
        ),
    ]
