"""
URL configuration voor documenten app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import SignedDocumentViewSet, SavedSignatureViewSet
from .explorer_views import FolderViewSet, FileEntryViewSet

router = DefaultRouter()
router.register(r'documents', SignedDocumentViewSet, basename='document')
router.register(r'signatures', SavedSignatureViewSet, basename='signature')
router.register(r'folders', FolderViewSet, basename='folder')
router.register(r'files', FileEntryViewSet, basename='file-entry')

urlpatterns = [
    path('', include(router.urls)),
]
