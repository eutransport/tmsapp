import apps.core.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0019_administratie_invoice_numbering'),
    ]

    operations = [
        migrations.AddField(
            model_name='appsettings',
            name='ai_gemini_api_key',
            field=apps.core.models.EncryptedCharField(
                blank=True,
                help_text='API key van Google AI Studio (aistudio.google.com/apikey)',
                max_length=512,
                verbose_name='Google Gemini API Key',
            ),
        ),
        migrations.AddField(
            model_name='appsettings',
            name='ai_gemini_model',
            field=models.CharField(
                blank=True,
                default='gemini-2.0-flash',
                help_text='Bijv: gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro',
                max_length=50,
                verbose_name='Gemini Model',
            ),
        ),
        migrations.AlterField(
            model_name='appsettings',
            name='ai_provider',
            field=models.CharField(
                choices=[
                    ('gemini', 'Google Gemini (Aanbevolen)'),
                    ('github', 'GitHub Models (Gratis)'),
                    ('openai', 'OpenAI'),
                    ('azure', 'Azure OpenAI'),
                    ('none', 'Uitgeschakeld'),
                ],
                default='gemini',
                help_text='Primaire AI provider. Als deze faalt vallen we terug op andere geconfigureerde providers.',
                max_length=20,
                verbose_name='AI Provider',
            ),
        ),
    ]
