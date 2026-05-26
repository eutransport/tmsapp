from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0016_add_administratie'),
    ]

    operations = [
        migrations.AddField(
            model_name='emailprofile',
            name='email_signature_image',
            field=models.ImageField(blank=True, null=True, upload_to='signatures/email_profiles/', verbose_name='E-mail Handtekening Afbeelding'),
        ),
    ]
