from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('companies', '0002_add_mailing_list_contact'),
    ]

    operations = [
        migrations.AddField(
            model_name='company',
            name='land',
            field=models.CharField(blank=True, max_length=100, verbose_name='Land'),
        ),
    ]
