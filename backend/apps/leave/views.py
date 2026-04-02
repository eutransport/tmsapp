"""Views for leave management."""
from decimal import Decimal
from datetime import date, timedelta
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone

from .audit import log_leave_action, get_client_ip, LeaveAuditAction
from .models import (
    GlobalLeaveSettings, 
    LeaveBalance, 
    LeaveRequest, 
    LeaveRequestStatus,
    LeaveType,
    PublicHoliday,
)
from .serializers import (
    GlobalLeaveSettingsSerializer,
    LeaveBalanceSerializer,
    LeaveBalanceAdminUpdateSerializer,
    LeaveRequestSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestAdminCreateSerializer,
    LeaveRequestAdminActionSerializer,
    CalendarLeaveEntrySerializer,
    ConcurrentLeaveCheckSerializer,
)


def _is_admin_or_leave_manager(user) -> bool:
    """Return True if the user is an admin or has the can_manage_leave_for_all permission."""
    if user.is_superuser or user.rol == 'admin':
        return True
    return 'can_manage_leave_for_all' in (user.module_permissions or [])


class GlobalLeaveSettingsViewSet(viewsets.ModelViewSet):
    """
    ViewSet for global leave settings.
    Only admins can view/edit.
    """
    serializer_class = GlobalLeaveSettingsSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        return GlobalLeaveSettings.objects.all()
    
    def list(self, request):
        """Return the singleton settings object."""
        settings_obj = GlobalLeaveSettings.get_settings()
        serializer = self.get_serializer(settings_obj)
        return Response(serializer.data)
    
    def create(self, request):
        """Update settings (create not allowed, use update)."""
        return Response(
            {'error': 'Gebruik PUT/PATCH om instellingen bij te werken.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED
        )
    
    @action(detail=False, methods=['put', 'patch'])
    def update_settings(self, request):
        """Update the global settings."""
        if not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Alleen admins kunnen instellingen wijzigen.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        settings_obj = GlobalLeaveSettings.get_settings()
        
        # Store old values for audit logging
        old_values = {
            'default_leave_hours': str(settings_obj.default_leave_hours),
            'max_concurrent_leave': settings_obj.max_concurrent_leave,
            'overtime_leave_percentage': settings_obj.overtime_leave_percentage,
            'free_special_leave_hours_per_month': str(settings_obj.free_special_leave_hours_per_month),
        }
        
        serializer = self.get_serializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        # Refresh from DB to get updated values
        settings_obj.refresh_from_db()
        
        # Audit log
        log_leave_action(
            action=LeaveAuditAction.SETTINGS_UPDATED,
            admin_user=request.user,
            details={
                'old_values': old_values,
                'new_values': {
                    'default_leave_hours': str(settings_obj.default_leave_hours),
                    'max_concurrent_leave': settings_obj.max_concurrent_leave,
                    'overtime_leave_percentage': settings_obj.overtime_leave_percentage,
                    'free_special_leave_hours_per_month': str(settings_obj.free_special_leave_hours_per_month),
                },
                'update_data': request.data,
            },
            ip_address=get_client_ip(request)
        )
        
        return Response(serializer.data)


class LeaveBalanceViewSet(viewsets.ModelViewSet):
    """
    ViewSet for leave balances.
    - Users can view their own balance
    - Admins can view/edit all balances
    """
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action in ['update', 'partial_update']:
            return LeaveBalanceAdminUpdateSerializer
        return LeaveBalanceSerializer
    
    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or user.rol == 'admin':
            return LeaveBalance.objects.select_related('user').all()
        return LeaveBalance.objects.filter(user=user)
    
    def list(self, request):
        """List all balances (admin) or own balance (user)."""
        queryset = self.get_queryset()
        serializer = LeaveBalanceSerializer(queryset, many=True)
        return Response(serializer.data)
    
    def retrieve(self, request, *args, **kwargs):
        """Get a balance - users can only see their own."""
        balance = self.get_object()
        if balance.user != request.user and not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Je hebt geen toegang tot dit verlofsaldo.'},
                status=status.HTTP_403_FORBIDDEN
            )
        serializer = self.get_serializer(balance)
        return Response(serializer.data)
    
    def create(self, request, *args, **kwargs):
        """Only admins can create balances manually."""
        if not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Verlofsaldo wordt automatisch aangemaakt.'},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().create(request, *args, **kwargs)
    
    def destroy(self, request, *args, **kwargs):
        """Disable deletion of balances."""
        return Response(
            {'error': 'Verlofsaldo kan niet worden verwijderd.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED
        )
    
    @action(detail=False, methods=['get'])
    def my_balance(self, request):
        """Get current user's leave balance."""
        try:
            balance = LeaveBalance.objects.get(user=request.user)
        except LeaveBalance.DoesNotExist:
            # Create balance if it doesn't exist
            settings_obj = GlobalLeaveSettings.get_settings()
            balance = LeaveBalance.objects.create(
                user=request.user,
                vacation_hours=settings_obj.default_leave_hours
            )
        
        serializer = LeaveBalanceSerializer(balance)
        return Response(serializer.data)
    
    def update(self, request, *args, **kwargs):
        """Only admins can update balances."""
        if not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Alleen admins kunnen verlofsaldo aanpassen.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Get the balance before update for audit logging
        balance = self.get_object()
        old_values = {
            'vacation_hours': str(balance.vacation_hours),
            'overtime_hours': str(balance.overtime_hours),
        }
        
        super().update(request, *args, **kwargs)
        
        # Audit log the balance update
        balance.refresh_from_db()
        log_leave_action(
            action=LeaveAuditAction.BALANCE_UPDATED,
            admin_user=request.user,
            target_user=balance.user,
            leave_balance=balance,
            details={
                'old_values': old_values,
                'new_values': {
                    'vacation_hours': str(balance.vacation_hours),
                    'overtime_hours': str(balance.overtime_hours),
                },
                'update_data': request.data,
            },
            ip_address=get_client_ip(request)
        )
        
        # Return full balance using LeaveBalanceSerializer
        return Response(LeaveBalanceSerializer(balance).data)
    
    def partial_update(self, request, *args, **kwargs):
        """Only admins can update balances."""
        if not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Alleen admins kunnen verlofsaldo aanpassen.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Get the balance before update for audit logging
        balance = self.get_object()
        old_values = {
            'vacation_hours': str(balance.vacation_hours),
            'overtime_hours': str(balance.overtime_hours),
        }
        
        super().partial_update(request, *args, **kwargs)
        
        # Audit log the balance update
        balance.refresh_from_db()
        log_leave_action(
            action=LeaveAuditAction.BALANCE_UPDATED,
            admin_user=request.user,
            target_user=balance.user,
            leave_balance=balance,
            details={
                'old_values': old_values,
                'new_values': {
                    'vacation_hours': str(balance.vacation_hours),
                    'overtime_hours': str(balance.overtime_hours),
                },
                'update_data': request.data,
            },
            ip_address=get_client_ip(request)
        )
        
        # Return full balance using LeaveBalanceSerializer
        return Response(LeaveBalanceSerializer(balance).data)


class LeaveRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet for leave requests.
    - Users can create/view their own requests
    - Admins can view all and approve/reject
    """
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return LeaveRequestCreateSerializer
        return LeaveRequestSerializer
    
    def get_queryset(self):
        user = self.request.user
        queryset = LeaveRequest.objects.select_related('user', 'reviewed_by')
        
        if _is_admin_or_leave_manager(user):
            # Admins and leave managers see all requests
            pass
        else:
            # Users see only their own
            queryset = queryset.filter(user=user)
        
        # Filter by status if provided
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Filter by user if provided (admin/leave-manager only)
        user_filter = self.request.query_params.get('user')
        if user_filter and _is_admin_or_leave_manager(user):
            queryset = queryset.filter(user_id=user_filter)
        
        return queryset
    
    def create(self, request, *args, **kwargs):
        """Create a new leave request."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        
        # Return full serializer
        return Response(
            LeaveRequestSerializer(instance).data,
            status=status.HTTP_201_CREATED
        )
    
    def update(self, request, *args, **kwargs):
        """
        Update a leave request.
        Users can only update their own PENDING requests.
        Admins use admin_update endpoint for full control.
        """
        leave_request = self.get_object()
        
        # Security: Check ownership
        if leave_request.user != request.user:
            if not _is_admin_or_leave_manager(request.user):
                return Response(
                    {'error': 'Je kunt alleen je eigen verlofaanvragen wijzigen.'},
                    status=status.HTTP_403_FORBIDDEN
                )
        
        # Users can only edit their own PENDING requests
        if leave_request.user == request.user and leave_request.status != LeaveRequestStatus.PENDING:
            return Response(
                {'error': 'Je kunt alleen aanvragen in afwachting wijzigen.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        return super().update(request, *args, **kwargs)
    
    def partial_update(self, request, *args, **kwargs):
        """Partial update - same security as update."""
        return self.update(request, *args, **kwargs)
    
    def destroy(self, request, *args, **kwargs):
        """
        Delete/cancel a leave request.
        Users can only cancel their own PENDING requests.
        Admins can delete any request via admin_action.
        """
        leave_request = self.get_object()
        
        # Security: Only owner can cancel, and only if pending
        if leave_request.user != request.user:
            return Response(
                {'error': 'Je kunt alleen je eigen verlofaanvragen annuleren.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if leave_request.status != LeaveRequestStatus.PENDING:
            return Response(
                {'error': 'Je kunt alleen aanvragen in afwachting annuleren. Neem contact op met admin voor goedgekeurde aanvragen.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Update status to cancelled instead of hard delete
        leave_request.status = LeaveRequestStatus.CANCELLED
        leave_request.save()
        
        return Response({'message': 'Verlofaanvraag geannuleerd.'}, status=status.HTTP_200_OK)
    
    def retrieve(self, request, *args, **kwargs):
        """
        Get a single leave request.
        Users can only see their own requests, admins can see all.
        """
        leave_request = self.get_object()
        
        # Security: Check if user has permission to view
        if leave_request.user != request.user:
            if not _is_admin_or_leave_manager(request.user):
                return Response(
                    {'error': 'Je hebt geen toegang tot deze verlofaanvraag.'},
                    status=status.HTTP_403_FORBIDDEN
                )
        
        serializer = self.get_serializer(leave_request)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def my_requests(self, request):
        """Get current user's leave requests."""
        queryset = LeaveRequest.objects.filter(user=request.user).order_by('-created_at')
        serializer = LeaveRequestSerializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def pending(self, request):
        """Get all pending requests (admin or leave manager only)."""
        if not _is_admin_or_leave_manager(request.user):
            return Response(
                {'error': 'Je hebt geen toegang om alle aanvragen te zien.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        queryset = LeaveRequest.objects.filter(
            status=LeaveRequestStatus.PENDING
        ).select_related('user').order_by('created_at')
        
        serializer = LeaveRequestSerializer(queryset, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def admin_create(self, request):
        """Admin or leave manager creates a leave request on behalf of a user."""
        if not _is_admin_or_leave_manager(request.user):
            return Response(
                {'error': 'Je hebt geen rechten om verlofaanvragen voor anderen aan te maken.'},
                status=status.HTTP_403_FORBIDDEN
            )

        serializer = LeaveRequestAdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            target_user = User.objects.get(id=data['user_id'], is_active=True)
        except User.DoesNotExist:
            return Response(
                {'error': 'Gebruiker niet gevonden.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Ensure user has a leave balance
        try:
            balance = target_user.leave_balance
        except LeaveBalance.DoesNotExist:
            settings_obj = GlobalLeaveSettings.get_settings()
            balance = LeaveBalance.objects.create(
                user=target_user,
                vacation_hours=settings_obj.default_leave_hours
            )

        # Create the leave request
        leave_request = LeaveRequest.objects.create(
            user=target_user,
            leave_type=data['leave_type'],
            start_date=data['start_date'],
            end_date=data['end_date'],
            hours_requested=data['hours_requested'],
            reason=data.get('reason', ''),
            status=LeaveRequestStatus.PENDING,
        )

        # Auto-approve if requested
        if data.get('auto_approve', True):
            deductions = leave_request.calculate_deductions()

            # Validate sufficient balance
            if deductions['vacation_deduct'] > balance.vacation_hours:
                leave_request.delete()
                return Response(
                    {'error': f"Onvoldoende verlofuren. Nodig: {deductions['vacation_deduct']}u, beschikbaar: {balance.vacation_hours}u"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if deductions['overtime_deduct'] > balance.available_overtime_for_leave:
                leave_request.delete()
                return Response(
                    {'error': f"Onvoldoende overuren. Nodig: {deductions['overtime_deduct']}u, beschikbaar: {balance.available_overtime_for_leave}u"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Apply deductions
            if deductions['vacation_deduct'] > 0:
                balance.deduct_vacation(deductions['vacation_deduct'])
            if deductions['overtime_deduct'] > 0:
                balance.deduct_overtime(deductions['overtime_deduct'])
            if deductions['special_free'] > 0:
                month_key = leave_request.get_month_key()
                balance.add_special_leave_used(month_key, deductions['special_free'])

            leave_request.status = LeaveRequestStatus.APPROVED
            leave_request.admin_comment = f'Aangemaakt door admin'
            leave_request.reviewed_by = request.user
            leave_request.reviewed_at = timezone.now()
            leave_request.save()

            # Audit log
            log_leave_action(
                action=LeaveAuditAction.REQUEST_APPROVED,
                admin_user=request.user,
                target_user=target_user,
                leave_request=leave_request,
                details={
                    'admin_created': True,
                    'auto_approved': True,
                    'deductions': {
                        'vacation': str(deductions['vacation_deduct']),
                        'overtime': str(deductions['overtime_deduct']),
                        'special_free': str(deductions['special_free']),
                    }
                },
                ip_address=get_client_ip(request)
            )
        else:
            # Audit log for creation without auto-approve
            log_leave_action(
                action=LeaveAuditAction.REQUEST_UPDATED,
                admin_user=request.user,
                target_user=target_user,
                leave_request=leave_request,
                details={'admin_created': True, 'auto_approved': False},
                ip_address=get_client_ip(request)
            )

        return Response(
            LeaveRequestSerializer(leave_request).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'])
    def admin_action(self, request, pk=None):
        """Admin or leave manager action to approve/reject/delete a request."""
        if not _is_admin_or_leave_manager(request.user):
            return Response(
                {'error': 'Je hebt geen rechten om verlofaanvragen te beheren.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        leave_request = self.get_object()
        action_serializer = LeaveRequestAdminActionSerializer(data=request.data)
        action_serializer.is_valid(raise_exception=True)
        
        action_type = action_serializer.validated_data['action']
        admin_comment = action_serializer.validated_data.get('admin_comment', '')
        
        if action_type == 'approve':
            return self._approve_request(request, leave_request, admin_comment)
        elif action_type == 'reject':
            return self._reject_request(request, leave_request, admin_comment)
        elif action_type == 'delete':
            return self._delete_request(request, leave_request)
        
        return Response({'error': 'Ongeldige actie.'}, status=status.HTTP_400_BAD_REQUEST)
    
    def _approve_request(self, request, leave_request, admin_comment):
        """Approve a leave request and deduct hours."""
        if leave_request.status != LeaveRequestStatus.PENDING:
            return Response(
                {'error': 'Alleen aanvragen in afwachting kunnen worden goedgekeurd.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get the user's balance
        try:
            balance = leave_request.user.leave_balance
        except LeaveBalance.DoesNotExist:
            return Response(
                {'error': 'Medewerker heeft geen verlofsaldo.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Calculate and apply deductions
        deductions = leave_request.calculate_deductions()
        
        # Validate sufficient balance
        if deductions['vacation_deduct'] > balance.vacation_hours:
            return Response(
                {'error': f"Onvoldoende verlofuren. Nodig: {deductions['vacation_deduct']}u, beschikbaar: {balance.vacation_hours}u"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if deductions['overtime_deduct'] > balance.available_overtime_for_leave:
            return Response(
                {'error': f"Onvoldoende overuren. Nodig: {deductions['overtime_deduct']}u, beschikbaar: {balance.available_overtime_for_leave}u"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Apply deductions
        if deductions['vacation_deduct'] > 0:
            balance.deduct_vacation(deductions['vacation_deduct'])
        
        if deductions['overtime_deduct'] > 0:
            balance.deduct_overtime(deductions['overtime_deduct'])
        
        if deductions['special_free'] > 0:
            month_key = leave_request.get_month_key()
            balance.add_special_leave_used(month_key, deductions['special_free'])
        
        # Update request status
        leave_request.status = LeaveRequestStatus.APPROVED
        leave_request.admin_comment = admin_comment
        leave_request.reviewed_by = request.user
        leave_request.reviewed_at = timezone.now()
        leave_request.save()
        
        # Audit log
        log_leave_action(
            action=LeaveAuditAction.REQUEST_APPROVED,
            admin_user=request.user,
            target_user=leave_request.user,
            leave_request=leave_request,
            details={
                'admin_comment': admin_comment,
                'deductions': {
                    'vacation': str(deductions['vacation_deduct']),
                    'overtime': str(deductions['overtime_deduct']),
                    'special_free': str(deductions['special_free']),
                }
            },
            ip_address=get_client_ip(request)
        )
        
        return Response({
            'message': 'Verlofaanvraag goedgekeurd.',
            'deductions': {
                'vacation': str(deductions['vacation_deduct']),
                'overtime': str(deductions['overtime_deduct']),
                'special_free': str(deductions['special_free']),
            }
        })
    
    def _reject_request(self, request, leave_request, admin_comment):
        """Reject a leave request."""
        if leave_request.status != LeaveRequestStatus.PENDING:
            return Response(
                {'error': 'Alleen aanvragen in afwachting kunnen worden afgewezen.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        leave_request.status = LeaveRequestStatus.REJECTED
        leave_request.admin_comment = admin_comment
        leave_request.reviewed_by = request.user
        leave_request.reviewed_at = timezone.now()
        leave_request.save()
        
        # Audit log
        log_leave_action(
            action=LeaveAuditAction.REQUEST_REJECTED,
            admin_user=request.user,
            target_user=leave_request.user,
            leave_request=leave_request,
            details={'admin_comment': admin_comment},
            ip_address=get_client_ip(request)
        )
        
        return Response({'message': 'Verlofaanvraag afgewezen.'})
    
    def _delete_request(self, request, leave_request):
        """Delete a leave request and refund hours if approved."""
        # Store info before deletion for logging
        leave_info = {
            'id': leave_request.id,
            'leave_type': leave_request.leave_type,
            'start_date': str(leave_request.start_date),
            'end_date': str(leave_request.end_date),
            'status_before_delete': leave_request.status,
        }
        target_user = leave_request.user
        
        # If it was approved, refund the hours
        if leave_request.status == LeaveRequestStatus.APPROVED:
            try:
                balance = leave_request.user.leave_balance
                deductions = leave_request.calculate_deductions()
                
                # Refund deductions
                if deductions['vacation_deduct'] > 0:
                    balance.vacation_hours += deductions['vacation_deduct']
                    balance.save(update_fields=['vacation_hours', 'updated_at'])
                    leave_info['refunded_vacation'] = str(deductions['vacation_deduct'])
                
                if deductions['overtime_deduct'] > 0:
                    balance.overtime_hours += deductions['overtime_deduct']
                    balance.save(update_fields=['overtime_hours', 'updated_at'])
                    leave_info['refunded_overtime'] = str(deductions['overtime_deduct'])
                
                # Note: special_free hours are not refunded as they're "use it or lose it"
            except LeaveBalance.DoesNotExist:
                pass
        
        leave_request.delete()
        
        # Audit log
        log_leave_action(
            action=LeaveAuditAction.REQUEST_DELETED,
            admin_user=request.user,
            target_user=target_user,
            details=leave_info,
            ip_address=get_client_ip(request)
        )
        
        return Response({'message': 'Verlofaanvraag verwijderd.'})
    
    @action(detail=True, methods=['patch'])
    def admin_update(self, request, pk=None):
        """Admin or leave manager action to update a leave request (edit dates, hours, type)."""
        if not _is_admin_or_leave_manager(request.user):
            return Response(
                {'error': 'Je hebt geen rechten om verlofaanvragen te bewerken.'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        leave_request = self.get_object()
        
        # Only allow editing pending or approved requests
        if leave_request.status not in [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED]:
            return Response(
                {'error': 'Alleen aanvragen in afwachting of goedgekeurde aanvragen kunnen worden bewerkt.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Store old values for audit logging
        old_values = {
            'leave_type': leave_request.leave_type,
            'start_date': str(leave_request.start_date),
            'end_date': str(leave_request.end_date),
            'hours_requested': str(leave_request.hours_requested),
            'reason': leave_request.reason,
            'status': leave_request.status,
        }
        
        # If approved, we need to recalculate balance adjustments
        was_approved = leave_request.status == LeaveRequestStatus.APPROVED
        old_deductions = leave_request.calculate_deductions() if was_approved else None
        
        # Update allowed fields
        allowed_fields = ['leave_type', 'start_date', 'end_date', 'hours_requested', 'reason']
        for field in allowed_fields:
            if field in request.data:
                setattr(leave_request, field, request.data[field])
        
        leave_request.save()
        
        # If was approved, adjust balance for the difference
        balance_adjustments = {}
        if was_approved and old_deductions:
            try:
                balance = leave_request.user.leave_balance
                new_deductions = leave_request.calculate_deductions()
                
                # Calculate difference and adjust
                vacation_diff = Decimal(str(new_deductions['vacation_deduct'])) - Decimal(str(old_deductions['vacation_deduct']))
                overtime_diff = Decimal(str(new_deductions['overtime_deduct'])) - Decimal(str(old_deductions['overtime_deduct']))
                
                if vacation_diff != 0:
                    balance.vacation_hours -= vacation_diff
                    balance.save(update_fields=['vacation_hours', 'updated_at'])
                    balance_adjustments['vacation_diff'] = str(vacation_diff)
                
                if overtime_diff != 0:
                    balance.overtime_hours -= overtime_diff
                    balance.save(update_fields=['overtime_hours', 'updated_at'])
                    balance_adjustments['overtime_diff'] = str(overtime_diff)
                    
            except LeaveBalance.DoesNotExist:
                pass
        
        # Audit log
        log_leave_action(
            action=LeaveAuditAction.REQUEST_UPDATED,
            admin_user=request.user,
            target_user=leave_request.user,
            leave_request=leave_request,
            details={
                'old_values': old_values,
                'new_values': {
                    'leave_type': leave_request.leave_type,
                    'start_date': str(leave_request.start_date),
                    'end_date': str(leave_request.end_date),
                    'hours_requested': str(leave_request.hours_requested),
                    'reason': leave_request.reason,
                },
                'update_data': request.data,
                'balance_adjustments': balance_adjustments if balance_adjustments else None,
            },
            ip_address=get_client_ip(request)
        )
        
        return Response({
            'message': 'Verlofaanvraag bijgewerkt.',
            'data': LeaveRequestSerializer(leave_request).data
        })
    
    @action(detail=False, methods=['get'])
    def calendar(self, request):
        """
        Get approved leave for calendar view.
        Query params: start_date, end_date
        """
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        if not start_date:
            start_date = date.today().replace(day=1)
        else:
            start_date = date.fromisoformat(start_date)
        
        if not end_date:
            # Default to 3 months ahead
            end_date = start_date + timedelta(days=90)
        else:
            end_date = date.fromisoformat(end_date)
        
        # Get approved leave requests in date range
        queryset = LeaveRequest.objects.filter(
            status=LeaveRequestStatus.APPROVED,
            start_date__lte=end_date,
            end_date__gte=start_date,
        ).select_related('user').order_by('start_date')
        
        # Serialize for calendar
        entries = []
        for req in queryset:
            entries.append({
                'id': req.id,
                'user_id': req.user_id,
                'user_naam': req.user.full_name,
                'leave_type': req.leave_type,
                'leave_type_display': req.get_leave_type_display(),
                'start_date': req.start_date,
                'end_date': req.end_date,
                'hours': req.hours_requested,
                'status': req.status,
            })
        
        return Response(entries)
    
    @action(detail=False, methods=['get'])
    def check_concurrent(self, request):
        """
        Check how many employees have approved leave for a date range.
        Query params: start_date, end_date
        """
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        if not start_date or not end_date:
            return Response(
                {'error': 'start_date en end_date zijn verplicht.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        start_date = date.fromisoformat(start_date)
        end_date = date.fromisoformat(end_date)
        
        # Get settings for max concurrent
        settings_obj = GlobalLeaveSettings.get_settings()
        max_concurrent = settings_obj.max_concurrent_leave
        
        # Find overlapping approved leave
        overlapping = LeaveRequest.objects.filter(
            status=LeaveRequestStatus.APPROVED,
            start_date__lte=end_date,
            end_date__gte=start_date,
        ).exclude(user=request.user).select_related('user')
        
        concurrent_users = list(set(req.user.full_name for req in overlapping))
        concurrent_count = len(concurrent_users)
        
        return Response({
            'start_date': start_date,
            'end_date': end_date,
            'concurrent_count': concurrent_count,
            'max_concurrent': max_concurrent,
            'warning': concurrent_count >= max_concurrent,
            'employees_on_leave': concurrent_users,
        })


class PublicHolidayViewSet(viewsets.ViewSet):
    """API endpoint to list public holidays for a year."""
    permission_classes = [IsAuthenticated]

    def list(self, request):
        year = request.query_params.get('year', date.today().year)
        year = int(year)
        PublicHoliday.ensure_year(year)
        holidays = PublicHoliday.objects.filter(year=year).order_by('date')
        data = [
            {'id': str(h.id), 'date': h.date.isoformat(), 'name': h.name, 'year': h.year}
            for h in holidays
        ]
        return Response(data)
