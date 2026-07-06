import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('loadlist', '0002_loadstop_time_window'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='loadlist',
            name='start_time',
            field=models.TimeField(blank=True, help_text='Vertrektijd vanaf depot', null=True),
        ),
        migrations.AddField(
            model_name='loadlist',
            name='end_time',
            field=models.TimeField(blank=True, help_text='Terug op depot uiterlijk (optioneel)', null=True),
        ),
        migrations.CreateModel(
            name='Depot',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(help_text='Herkenbare naam, bv. "DACHSER Waddinxveen"', max_length=120)),
                ('address', models.CharField(help_text='Volledig adres zoals in Google Maps', max_length=300)),
                ('lat', models.FloatField(blank=True, null=True)),
                ('lng', models.FloatField(blank=True, null=True)),
                ('is_default', models.BooleanField(default=False, help_text='Automatisch vooringevuld voor nieuwe lijsten')),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name='created_depots', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Depot',
                'verbose_name_plural': 'Depots',
                'ordering': ['-is_default', 'name'],
            },
        ),
    ]
