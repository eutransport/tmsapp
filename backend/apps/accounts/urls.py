"""
Accounts app URL configuration.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView, TokenBlacklistView

from .views import (
    CustomTokenObtainPairView,
    EntraConfigView,
    EntraLoginView,
    MFAVerifyView,
    RegisterView,
    ProfileView,
    PasswordChangeView,
    MFASetupView,
    MFADisableView,
    UserViewSet,
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='users')

urlpatterns = [
    # JWT Authentication
    path('login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('login/verify-2fa/', MFAVerifyView.as_view(), name='token_verify_2fa'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('logout/', TokenBlacklistView.as_view(), name='token_blacklist'),

    # Inloggen via Microsoft Entra External ID
    path('entra/config/', EntraConfigView.as_view(), name='entra_config'),
    path('entra/login/', EntraLoginView.as_view(), name='entra_login'),
    
    # Registration
    path('register/', RegisterView.as_view(), name='register'),
    
    # Current user profile
    path('profile/', ProfileView.as_view(), name='profile'),
    path('profile/change-password/', PasswordChangeView.as_view(), name='change_password'),
    
    # 2FA Management
    path('profile/2fa/setup/', MFASetupView.as_view(), name='mfa_setup'),
    path('profile/2fa/disable/', MFADisableView.as_view(), name='mfa_disable'),
    
    # Admin user management
    path('', include(router.urls)),
]
