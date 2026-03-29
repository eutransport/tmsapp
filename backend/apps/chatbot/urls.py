"""URL configuration for the chatbot app."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ChatSessionViewSet

router = DefaultRouter()
router.register(r'sessions', ChatSessionViewSet, basename='chatsession')

urlpatterns = [
    path('', include(router.urls)),
    # Quick-send endpoint (no session required)
    path('message/', ChatSessionViewSet.as_view({'post': 'quick_message'}), name='chat-quick-message'),
]
