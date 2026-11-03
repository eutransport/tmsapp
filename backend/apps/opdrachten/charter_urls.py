from django.urls import path

from .charter_views import (
    CharterPositiesView,
    CharterRittenView,
    CharterTolView,
    CharterUrenView,
    CharterVoertuigDagView,
    CharterVoertuigenView,
)

urlpatterns = [
    path('voertuigen/', CharterVoertuigenView.as_view(), name='charter-voertuigen'),
    path('voertuigen/<str:kenteken>/dag/', CharterVoertuigDagView.as_view(), name='charter-voertuig-dag'),
    path('posities/', CharterPositiesView.as_view(), name='charter-posities'),
    path('ritten/', CharterRittenView.as_view(), name='charter-ritten'),
    path('uren/', CharterUrenView.as_view(), name='charter-uren'),
    path('tol/', CharterTolView.as_view(), name='charter-tol'),
]
