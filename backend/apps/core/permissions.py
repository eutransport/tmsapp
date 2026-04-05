"""
Custom permission classes for TMS.
"""
from rest_framework.permissions import BasePermission


class HasModulePermission(BasePermission):
    """
    Permission that checks the user's module_permissions.
    Admins always pass. Non-admin users need the specified permission code.
    
    Usage:
        class MyView(APIView):
            permission_classes = [IsAuthenticated, HasModulePermission]
            module_permission = 'view_invoices'
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Admins/superusers bypass module permission checks
        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        required = getattr(view, 'module_permission', None)
        if not required:
            return True  # No permission configured on the view

        return request.user.has_module_permission(required)


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


class IsAdminOrLeaveManagerReadOnly(BasePermission):
    """
    Admins get full access. Users with can_manage_leave_for_all
    module permission get read-only access (list/retrieve).
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return request.user.has_module_permission('can_manage_leave_for_all')

        return False


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


class PlanningPermission(BasePermission):
    """
    Planning permission:
    - Admins: full access
    - manage_all_planning: full CRUD on all planning
    - view_all_planning: read-only on all planning
    - All authenticated users: read-only on own planning (my_planning)
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        # my_planning is accessible to all authenticated users
        if getattr(view, 'action', None) == 'my_planning':
            return True

        # current_week and next_week are informational
        if getattr(view, 'action', None) in ('current_week', 'next_week'):
            return True

        # manage_all_planning: full CRUD
        if request.user.has_module_permission('manage_all_planning'):
            return True

        # view_all_planning: read-only
        if request.user.has_module_permission('view_all_planning'):
            return request.method in ['GET', 'HEAD', 'OPTIONS']

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
