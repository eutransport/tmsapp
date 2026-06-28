from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_add_module_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='nav_favorites',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text='Lijst van hrefs van menu-items die de gebruiker als favoriet heeft gemarkeerd.',
                verbose_name='Favoriete menu-items',
            ),
        ),
    ]
