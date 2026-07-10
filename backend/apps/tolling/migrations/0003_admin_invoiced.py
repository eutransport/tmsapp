from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0002_private_toll_registration'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='privatetollregistration',
            name='admin_invoiced',
            field=models.BooleanField(db_index=True, default=False, verbose_name='Gefactureerd aan chauffeur'),
        ),
        migrations.AddField(
            model_name='privatetollregistration',
            name='admin_invoiced_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Gefactureerd op'),
        ),
        migrations.AddField(
            model_name='privatetollregistration',
            name='admin_invoiced_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='private_toll_admin_invoiced',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Gemarkeerd door',
            ),
        ),
    ]
