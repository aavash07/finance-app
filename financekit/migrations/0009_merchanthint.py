from django.db import migrations, models
import django.conf
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [
        ('financekit', '0008_rename_financekit_created_ae_idx_financekit__created_435cd5_idx_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='MerchantHint',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('merchant', models.CharField(max_length=255)),
                ('count', models.IntegerField(default=0)),
                ('last_seen', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=django.conf.settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [
                    models.Index(fields=['user', 'merchant'], name='financekit_user_merch_idx'),
                    models.Index(fields=['user', 'last_seen'], name='financekit_user_last_idx'),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name='merchanthint',
            constraint=models.UniqueConstraint(fields=('user', 'merchant'), name='uniq_user_merchant_hint'),
        ),
    ]
