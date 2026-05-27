from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_emailprofile_signature_image'),
    ]

    operations = [
        migrations.AddField(
            model_name='appsettings',
            name='email_signature_image',
            field=models.ImageField(blank=True, null=True, upload_to='signatures/email_settings/', verbose_name='E-mail Handtekening Afbeelding'),
        ),
    ]
