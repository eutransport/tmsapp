import django.db.models.deletion
from django.db import migrations, models

import apps.tasks.models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0008_add_administratie_to_invoice'),
        ('tasks', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='factuur',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tasks',
                to='invoicing.invoice',
                verbose_name='Gekoppelde factuur',
            ),
        ),
        migrations.AddField(
            model_name='task',
            name='bijlage',
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=apps.tasks.models.task_bijlage_upload_path,
                verbose_name='Bijlage',
            ),
        ),
    ]
