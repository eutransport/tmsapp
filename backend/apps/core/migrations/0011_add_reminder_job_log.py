"""
Migration to add ReminderJobLog model for tracking cron job executions.
"""
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_add_reminder_settings'),
    ]

    operations = [
        migrations.CreateModel(
            name='ReminderJobLog',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('started_at', models.DateTimeField(auto_now_add=True, verbose_name='Gestart op')),
                ('finished_at', models.DateTimeField(blank=True, null=True, verbose_name='Beëindigd op')),
                ('status', models.CharField(
                    choices=[
                        ('success', 'Succesvol'),
                        ('error', 'Fout'),
                        ('warning', 'Waarschuwing'),
                        ('skipped', 'Overgeslagen'),
                    ],
                    default='success',
                    max_length=20,
                    verbose_name='Status'
                )),
                ('reminders_sent', models.IntegerField(default=0, verbose_name='Herinneringen verstuurd')),
                ('message', models.TextField(blank=True, default='', verbose_name='Bericht')),
            ],
            options={
                'verbose_name': 'Herinnering Job Log',
                'verbose_name_plural': 'Herinnering Job Logs',
                'ordering': ['-started_at'],
            },
        ),
    ]
