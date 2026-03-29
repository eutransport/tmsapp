"""
Custom permission classes for TMS.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdminOrManager(BasePermission):
    """
    Permission that only allows admin or gebruiker (manager) roles.
    Chauffeurs have read-only access.
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Superusers always have access
        if request.user.is_superuser:
            return True
        
        # Admin and gebruiker roles have full access
        if request.user.rol in ['admin', 'gebruiker']:
            return True
        
        # Chauffeurs only have read access (GET, HEAD, OPTIONS)
        if request.user.rol == 'chauffeur':
            return request.method in ['GET', 'HEAD', 'OPTIONS']
        
        return False


class IsAdminOrManagerStrict(BasePermission):
    """
    Permission that only allows admin or gebruiker (manager) roles.
    Chauffeurs are fully blocked (no read access).
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        if request.user.is_superuser:
            return True
        
        return request.user.rol in ['admin', 'gebruiker']


class IsAdminOnly(BasePermission):
    """
    Permission that only allows admin role.
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Superusers always have access
        if request.user.is_superuser:
            return True
        
        # Only admin role
        return request.user.rol == 'admin'


class IsAdminOrLeaveManagerReadOnly(BasePermission):
    """
    Permission that allows admins full access and leave managers (users with
    can_manage_leave_for_all permission) read-only access.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        if 'can_manage_leave_for_all' in (request.user.module_permissions or []):
            return request.method in SAFE_METHODS

        return False


class IsOwnerOrAdmin(BasePermission):
    """
    Permission for objects that belong to a user.
    Users can only access their own objects, admins can access all.
    """
    
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated
    
    def has_object_permission(self, request, view, obj):
        # Superusers and admins can access all
        if request.user.is_superuser or request.user.rol == 'admin':
            return True
        
        # Check if object has a user field
        if hasattr(obj, 'user'):
            return obj.user == request.user
        if hasattr(obj, 'gekoppelde_gebruiker'):
            return obj.gekoppelde_gebruiker == request.user
        
        return False
