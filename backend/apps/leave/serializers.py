"""Serializers for leave management."""
from decimal import Decimal
from rest_framework import serializers
from django.utils import timezone

from .models import GlobalLeaveSettings, LeaveBalance, LeaveRequest, LeaveType, LeaveRequestStatus, PublicHoliday


class GlobalLeaveSettingsSerializer(serializers.ModelSerializer):
    """Serializer for global leave settings."""
    # Numeric aliases for frontend compatibility
    default_vacation_hours = serializers.DecimalField(
        source='default_leave_hours', max_digits=7, decimal_places=2, read_only=True
    )
    work_week_hours = serializers.DecimalField(
        source='standard_work_week_hours', max_digits=5, decimal_places=2, read_only=True
    )
    free_special_leave_hours = serializers.DecimalField(
        source='free_special_leave_hours_per_month', max_digits=5, decimal_places=2, read_only=True
    )
    
    class Meta:
        model = GlobalLeaveSettings
        fields = [
            'id',
            'default_leave_hours',
            'default_vacation_hours',  # alias
            'standard_work_week_hours',
            'work_week_hours',  # alias
            'overtime_leave_percentage',
            'max_concurrent_leave',
            'free_special_leave_hours_per_month',
            'free_special_leave_hours',  # alias
            'updated_at',
        ]
        read_only_fields = ['id', 'updated_at']


class LeaveBalanceSerializer(serializers.ModelSerializer):
    """Serializer for leave balance."""
    user_naam = serializers.SerializerMethodField()
    user_email = serializers.CharField(source='user.email', read_only=True)
    available_overtime_for_leave = serializers.DecimalField(
        max_digits=7, 
        decimal_places=2, 
        read_only=True
    )
    
    class Meta:
        model = LeaveBalance
        fields = [
            'id',
            'user',
            'user_naam',
            'user_email',
            'vacation_hours',
            'overtime_hours',
            'available_overtime_for_leave',
            'special_leave_used',
            'updated_at',
        ]
        read_only_fields = ['id', 'user', 'overtime_hours', 'special_leave_used', 'updated_at']
    
    def get_user_naam(self, obj):
        return obj.user.full_name


class LeaveBalanceAdminUpdateSerializer(serializers.ModelSerializer):
    """Serializer for admin to update vacation and overtime hours."""
    
    class Meta:
        model = LeaveBalance
        fields = ['vacation_hours', 'overtime_hours']


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Serializer for leave requests."""
    user_naam = serializers.SerializerMethodField()
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    reviewed_by_naam = serializers.SerializerMethodField()
    deductions = serializers.SerializerMethodField()
    # Aliases for frontend compatibility
    hours = serializers.DecimalField(source='hours_requested', max_digits=7, decimal_places=2, read_only=True)
    notes = serializers.CharField(source='reason', read_only=True)
    
    class Meta:
        model = LeaveRequest
        fields = [
            'id',
            'user',
            'user_naam',
            'leave_type',
            'leave_type_display',
            'start_date',
            'end_date',
            'hours_requested',
            'hours',  # alias
            'reason',
            'notes',  # alias
            'status',
            'status_display',
            'admin_comment',
            'reviewed_by',
            'reviewed_by_naam',
            'reviewed_at',
            'deductions',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id', 'user', 'status', 'admin_comment', 
            'reviewed_by', 'reviewed_at', 'created_at', 'updated_at'
        ]
    
    def get_user_naam(self, obj):
        return obj.user.full_name
    
    def get_reviewed_by_naam(self, obj):
        if obj.reviewed_by:
            return obj.reviewed_by.full_name
        return None
    
    def get_deductions(self, obj):
        if obj.status == LeaveRequestStatus.APPROVED:
            return obj.calculate_deductions()
        return None
    
    def validate(self, data):
        """Validate leave request."""
        user = self.context['request'].user
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        leave_type = data.get('leave_type')
        hours_requested = data.get('hours_requested')
        
        # Validate dates
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError({
                'end_date': 'Einddatum moet na startdatum liggen.'
            })
        
        # Validate hours
        no_deduct_types = [LeaveType.ZIEKTEVERZUIM, LeaveType.BIJZONDER_TANDARTS, LeaveType.BIJZONDER_HUISARTS]
        if leave_type not in no_deduct_types:
            if hours_requested and hours_requested <= 0:
                raise serializers.ValidationError({
                    'hours_requested': 'Aantal uren moet groter zijn dan 0.'
                })
        
        # Check balance for leave type
        try:
            balance = user.leave_balance
        except LeaveBalance.DoesNotExist:
            raise serializers.ValidationError('Geen verlofsaldo gevonden.')
        
        if leave_type == LeaveType.VAKANTIE:
            if hours_requested > balance.vacation_hours:
                raise serializers.ValidationError({
                    'hours_requested': f'Onvoldoende verlofuren. Beschikbaar: {balance.vacation_hours}u'
                })
        
        elif leave_type == LeaveType.OVERUREN:
            available = balance.available_overtime_for_leave
            if hours_requested > available:
                raise serializers.ValidationError({
                    'hours_requested': f'Onvoldoende overuren beschikbaar voor verlof. Beschikbaar: {available}u'
                })
        
        # Bijzonder verlof and ziekteverzuim: no balance check needed
        
        return data


class LeaveRequestCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating leave requests."""
    
    class Meta:
        model = LeaveRequest
        fields = [
            'leave_type',
            'start_date',
            'end_date',
            'hours_requested',
            'reason',
        ]
    
    def validate(self, data):
        """Validate leave request."""
        user = self.context['request'].user
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        leave_type = data.get('leave_type')
        
        # Validate dates
        if start_date > end_date:
            raise serializers.ValidationError({
                'end_date': 'Einddatum moet na startdatum liggen.'
            })
        
        # Recalculate hours based on actual work days (excluding holidays)
        # Ziekteverzuim and bijzonder verlof: set hours to 0 (no deduction)
        no_deduct_types = [LeaveType.ZIEKTEVERZUIM, LeaveType.BIJZONDER_TANDARTS, LeaveType.BIJZONDER_HUISARTS]
        if leave_type in no_deduct_types:
            hours_requested = Decimal('0')
            data['hours_requested'] = hours_requested
        else:
            work_days = PublicHoliday.count_work_days(start_date, end_date)
            hours_requested = Decimal(str(work_days * 8))
            data['hours_requested'] = hours_requested
            
            # Validate hours
            if hours_requested <= 0:
                raise serializers.ValidationError({
                    'hours_requested': 'Geen werkdagen in de geselecteerde periode (alleen feestdagen/weekenden).'
                })
        
        # Check balance for leave type
        try:
            balance = user.leave_balance
        except LeaveBalance.DoesNotExist:
            raise serializers.ValidationError('Geen verlofsaldo gevonden.')
        
        if leave_type == LeaveType.VAKANTIE:
            if hours_requested > balance.vacation_hours:
                raise serializers.ValidationError({
                    'hours_requested': f'Onvoldoende verlofuren. Beschikbaar: {balance.vacation_hours}u'
                })
        
        elif leave_type == LeaveType.OVERUREN:
            available = balance.available_overtime_for_leave
            if hours_requested > available:
                raise serializers.ValidationError({
                    'hours_requested': f'Onvoldoende overuren beschikbaar voor verlof. Beschikbaar: {available}u'
                })
        
        # Bijzonder verlof and ziekteverzuim: no balance check needed
        
        return data
    
    def create(self, validated_data):
        validated_data['user'] = self.context['request'].user
        return super().create(validated_data)


class LeaveRequestAdminCreateSerializer(serializers.Serializer):
    """Serializer for admin creating leave requests on behalf of a user."""
    user_id = serializers.UUIDField()
    leave_type = serializers.ChoiceField(choices=LeaveType.choices)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    hours_requested = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, default=Decimal('0')
    )
    reason = serializers.CharField(required=False, allow_blank=True, default='')
    auto_approve = serializers.BooleanField(default=True)

    def validate(self, data):
        if data['start_date'] > data['end_date']:
            raise serializers.ValidationError({
                'end_date': 'Einddatum moet na startdatum liggen.'
            })
        no_deduct_types = [LeaveType.ZIEKTEVERZUIM, LeaveType.BIJZONDER_TANDARTS, LeaveType.BIJZONDER_HUISARTS]
        if data['leave_type'] in no_deduct_types:
            data['hours_requested'] = Decimal('0')
        elif data['hours_requested'] <= 0:
            raise serializers.ValidationError({
                'hours_requested': 'Aantal uren moet groter zijn dan 0.'
            })
        return data


class LeaveRequestAdminActionSerializer(serializers.Serializer):
    """Serializer for admin actions on leave requests."""
    action = serializers.ChoiceField(choices=['approve', 'reject', 'delete'])
    admin_comment = serializers.CharField(required=False, allow_blank=True)


class CalendarLeaveEntrySerializer(serializers.Serializer):
    """Serializer for calendar view of leave."""
    id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    user_naam = serializers.CharField()
    leave_type = serializers.CharField()
    leave_type_display = serializers.CharField()
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    hours = serializers.DecimalField(max_digits=6, decimal_places=2)
    status = serializers.CharField()


class ConcurrentLeaveCheckSerializer(serializers.Serializer):
    """Serializer for checking concurrent leave."""
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    concurrent_count = serializers.IntegerField()
    max_concurrent = serializers.IntegerField()
    warning = serializers.BooleanField()
    employees_on_leave = serializers.ListField(child=serializers.CharField())
