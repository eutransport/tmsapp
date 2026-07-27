"""
Voeg bedrijfsgegevens toe aan Administratie: logo, adres (straat/huisnr/
postcode/plaats/land), kvk, btw, iban, telefoon, email.

Alle velden zijn optioneel (blank=True + default='') zodat bestaande records
zonder waarde blijven werken. De PDF-generator valt bij een lege waarde terug
op AppSettings.company_* zodat bestaand gedrag intact blijft.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_add_gemini_ai_provider'),
    ]

    operations = [
        migrations.AddField(
            model_name='administratie',
            name='logo',
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to='administraties/logos/',
                verbose_name='Logo',
                help_text='Logo dat op facturen van deze administratie wordt getoond '
                          '(gebruikt bij het moderne factuur-template).',
            ),
        ),
        migrations.AddField(
            model_name='administratie',
            name='straat',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Straat'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='huisnummer',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='Huisnummer'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='postcode',
            field=models.CharField(blank=True, default='', max_length=10, verbose_name='Postcode'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='plaats',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='Plaats'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='land',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='Land'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='kvk',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='KVK Nummer'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='btw',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='BTW Nummer'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='iban',
            field=models.CharField(blank=True, default='', max_length=34, verbose_name='IBAN'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='telefoon',
            field=models.CharField(blank=True, default='', max_length=30, verbose_name='Telefoon'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='email',
            field=models.EmailField(blank=True, default='', max_length=254, verbose_name='E-mail'),
        ),
    ]
