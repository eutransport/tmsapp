from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    BankAccountViewSet,
    BankImportViewSet,
    BankTransactionViewSet,
    BankStatementImportView,
    BankRematchView,
)

router = DefaultRouter()
router.register(r'accounts', BankAccountViewSet, basename='bank-accounts')
router.register(r'imports', BankImportViewSet, basename='bank-imports')
router.register(r'transactions', BankTransactionViewSet, basename='bank-transactions')

urlpatterns = [
    path('', include(router.urls)),
    path('import/', BankStatementImportView.as_view(), name='bank-statement-import'),
    path(
        'accounts/<uuid:bankrekening_id>/rematch/',
        BankRematchView.as_view(),
        name='bank-rematch',
    ),
]
