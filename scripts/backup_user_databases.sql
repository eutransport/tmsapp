/*
    Backup-script: maakt een FULL back-up van alle gebruikersdatabases.
    De systeemdatabases (master, model, msdb, tempdb) worden NIET meegenomen.
    Bestandsnaam: <DatabaseNaam>_<JJJJMMDD>.bak
    Doel: netwerkshare die hieronder wordt opgegeven.

    LET OP:
      - De SQL Server service-account moet schrijfrechten hebben op de netwerkshare.
      - Gebruik een UNC-pad (\\server\share\map), geen toegewezen stationsletter (Z:\),
        want de service-account "ziet" toegewezen schijven meestal niet.
*/

SET NOCOUNT ON;

----------------------------------------------------------------------
-- >>> HIER de netwerkshare opgeven (eindig met een backslash) <<<
----------------------------------------------------------------------
DECLARE @BackupPath NVARCHAR(512) = N'\\NETWERKSERVER\Backups\SQL\';
----------------------------------------------------------------------

DECLARE @DbName     SYSNAME;
DECLARE @FileName   NVARCHAR(1024);
DECLARE @DateStamp  NVARCHAR(8) = CONVERT(NVARCHAR(8), GETDATE(), 112); -- JJJJMMDD
DECLARE @Sql        NVARCHAR(MAX);

DECLARE db_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT name
    FROM sys.databases
    WHERE database_id > 4                 -- sluit master(1), tempdb(2), model(3), msdb(4) uit
      AND name NOT IN (N'master', N'model', N'msdb', N'tempdb')
      AND state_desc = N'ONLINE'          -- alleen online databases
      AND is_read_only = 0;               -- sla read-only / replica's over

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @DbName;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @FileName = @BackupPath + @DbName + N'_' + @DateStamp + N'.bak';

    SET @Sql = N'BACKUP DATABASE ' + QUOTENAME(@DbName) +
               N' TO DISK = N''' + REPLACE(@FileName, '''', '''''') + N'''' +
               N' WITH FORMAT, INIT, COMPRESSION, STATS = 10, ' +
               N'NAME = N''' + @DbName + N' - Full Backup'';';

    BEGIN TRY
        PRINT N'Back-up gestart voor database: ' + @DbName;
        EXEC sp_executesql @Sql;
        PRINT N'Back-up voltooid: ' + @FileName;
    END TRY
    BEGIN CATCH
        PRINT N'FOUT bij back-up van database ' + @DbName + N': ' + ERROR_MESSAGE();
    END CATCH;

    FETCH NEXT FROM db_cursor INTO @DbName;
END

CLOSE db_cursor;
DEALLOCATE db_cursor;

PRINT N'Alle gebruikersdatabases zijn verwerkt.';
