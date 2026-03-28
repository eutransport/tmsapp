from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('fleet', '0004_vehicle_kenteken_unique_constraint'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
            DO $$
            DECLARE
                con_name TEXT;
                idx_name TEXT;
            BEGIN
                -- Drop unique constraints on kenteken (other than our conditional one)
                FOR con_name IN
                    SELECT con.conname
                    FROM pg_constraint con
                    JOIN pg_class cls ON cls.oid = con.conrelid
                    JOIN pg_attribute att ON att.attrelid = con.conrelid
                        AND att.attnum = ANY(con.conkey)
                    WHERE cls.relname = 'fleet_vehicle'
                      AND con.contype = 'u'
                      AND att.attname = 'kenteken'
                      AND con.conname != 'unique_kenteken_actief'
                LOOP
                    EXECUTE format('ALTER TABLE fleet_vehicle DROP CONSTRAINT IF EXISTS %I', con_name);
                END LOOP;

                -- Drop any remaining standalone unique indexes on kenteken
                FOR idx_name IN
                    SELECT indexname
                    FROM pg_indexes
                    WHERE tablename = 'fleet_vehicle'
                      AND indexdef ILIKE '%kenteken%'
                      AND indexname != 'unique_kenteken_actief'
                      AND indexdef ILIKE '%unique%'
                LOOP
                    EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
                END LOOP;
            END
            $$;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
