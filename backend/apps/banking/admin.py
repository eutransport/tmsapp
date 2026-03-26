from django.contrib import admin
from .models import BankAccount, BankImport, BankTransaction


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ['naam', 'bank', 'iban', 'is_active', 'created_at']
    list_filter = ['bank', 'is_active']
    search_fields = ['naam', 'iban']


@admin.register(BankImport)
class BankImportAdmin(admin.ModelAdmin):
    list_display = ['bankrekening', 'bestandsnaam', 'status', 'aantal_transacties', 'aantal_gematcht', 'created_at']
    list_filter = ['status', 'bankrekening']
    search_fields = ['bestandsnaam']


@admin.register(BankTransaction)
class BankTransactionAdmin(admin.ModelAdmin):
    list_display = ['datum', 'bankrekening', 'bedrag', 'naam_tegenpartij', 'match_status', 'gevonden_factuurnummer']
    list_filter = ['match_status', 'bankrekening', 'datum']
    search_fields = ['naam_tegenpartij', 'omschrijving', 'gevonden_factuurnummer']
    raw_id_fields = ['gekoppelde_factuur']
