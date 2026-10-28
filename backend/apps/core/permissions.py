"""
Custom permission classes for TMS.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


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


class HasReadWriteModulePermission(BasePermission):
    """
    Permission that checks read/write module permissions separately.
    - GET/HEAD/OPTIONS: requires ``module_permission_read``.
    - Other methods: requires ``module_permission_write``.
    Admins/superusers always pass. If an attribute is missing that side is allowed.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        if request.method in SAFE_METHODS:
            required = getattr(view, 'module_permission_read', None)
        else:
            required = getattr(view, 'module_permission_write', None)

        if not required:
            return True
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


class NietVoorChauffeur(BasePermission):
    """
    Interne kantoormodules: chauffeurs en opdrachtgevers horen hier niet.
    """

    message = 'Deze module is niet beschikbaar voor jouw rol.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser:
            return True

        return request.user.rol not in ('chauffeur', 'opdrachtgever')


class IsOpdrachtgever(BasePermission):
    """
    Alleen externe opdrachtgevers met een gekoppeld bedrijf.

    De koppeling is verplicht: zonder bedrijf valt er niets te filteren en zou
    een view ongemerkt alles kunnen teruggeven.
    """

    message = 'Alleen beschikbaar voor opdrachtgevers met een gekoppeld bedrijf.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return bool(
            getattr(request.user, 'is_opdrachtgever', False)
            and request.user.opdrachtgever_bedrijf_id
        )


class KanVoertuigenVolgen(BasePermission):
    """
    Track & trace: live posities en rithistorie van voertuigen.

    Een opdrachtgever hoort hier nooit: die ziet zijn eigen ritten via het
    klantportaal en mag niet bij de hele vloot. Overige rollen hebben het
    recht ``view_track_trace`` nodig.

    Een chauffeur wordt standaard geweigerd. Views die hun resultaat zelf op
    de ingelogde chauffeur filteren zetten ``chauffeur_ziet_eigen_data = True``
    om hem alsnog toe te laten. Dat is bewust omgekeerd: een view die die
    filtering niet heeft, lekt zo nooit per ongeluk de hele vloot.
    """

    message = 'Je hebt geen toegang tot track & trace.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser or user.rol == 'admin':
            return True

        if user.rol == 'opdrachtgever':
            return False

        if user.rol == 'chauffeur':
            return getattr(view, 'chauffeur_ziet_eigen_data', False)

        return user.has_module_permission('view_track_trace')


class KanTachograafZien(BasePermission):
    """
    Tachograaf en rijtijden.

    Dit is herleidbare rijtijdendata van individuele chauffeurs en staat
    daarom los van track & trace: wie wagens mag volgen, hoeft nog niet bij
    de rijtijden te kunnen. Vereist het recht ``view_tachograph``.
    """

    message = 'Je hebt geen toegang tot de tachograafgegevens.'

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser or user.rol == 'admin':
            return True

        if user.rol in ('chauffeur', 'opdrachtgever'):
            return False

        return user.has_module_permission('view_tachograph')


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


class FleetPermission(BasePermission):
    """
    Fleet permission:
    - Admins: full access
    - manage_fleet: full CRUD
    - view_fleet: read-only
    - dropdown action: all authenticated users (for vehicle selection in time entries)
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        # dropdown is accessible to all authenticated users
        if getattr(view, 'action', None) == 'dropdown':
            return True

        # manage_fleet: full CRUD
        if request.user.has_module_permission('manage_fleet'):
            return True

        # view_fleet: read-only
        if request.user.has_module_permission('view_fleet'):
            return request.method in ['GET', 'HEAD', 'OPTIONS']

        return False


class SubmittedHoursPermission(BasePermission):
    """
    Submitted hours permission for admin-level time entry management:
    - Admins: full access
    - manage_submitted_hours: full CRUD on all entries
    - view_submitted_hours: read-only on all entries
    - All authenticated users: always access their own entries
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser or request.user.rol == 'admin':
            return True

        # manage_submitted_hours: full CRUD
        if request.user.has_module_permission('manage_submitted_hours'):
            return True

        # view_submitted_hours: read-only
        if request.user.has_module_permission('view_submitted_hours'):
            return request.method in ['GET', 'HEAD', 'OPTIONS']

        # All authenticated users can manage their own entries
        # (filtered in get_queryset)
        return True


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
