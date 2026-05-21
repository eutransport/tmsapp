import sys

path = r'C:\Users\user01\Documents\GitHub\tmsapp\backend\apps\leave\views.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

ANCHOR = "        return Response({'message': 'Verlofaanvraag verwijderd.'})\n    \n    @action(detail=True, methods=['patch'])\n    def admin_update(self, request, pk=None):"

INSERT = """    @action(detail=True, methods=['post'], url_path='force_delete', url_name='force-delete')
    def force_delete_entry(self, request, pk=None):
        if not _is_admin_or_leave_manager(request.user):
            return Response(
                {'error': 'Je hebt geen rechten om verlofaanvragen te verwijderen.'},
                status=status.HTTP_403_FORBIDDEN
            )
        leave_request = self.get_object()
        leave_info = {
            'id': leave_request.id,
            'leave_type': leave_request.leave_type,
            'start_date': str(leave_request.start_date),
            'end_date': str(leave_request.end_date),
            'status_before_delete': leave_request.status,
            'force_delete': True,
        }
        target_user = leave_request.user
        leave_request.delete()
        log_leave_action(
            action=LeaveAuditAction.REQUEST_DELETED,
            admin_user=request.user,
            target_user=target_user,
            details=leave_info,
            ip_address=get_client_ip(request)
        )
        return Response({'message': 'Verlofaanvraag verwijderd (force).'})

"""

REPLACEMENT = "        return Response({'message': 'Verlofaanvraag verwijderd.'})\n    \n    " + INSERT + "    @action(detail=True, methods=['patch'])\n    def admin_update(self, request, pk=None):"

if ANCHOR in content:
    content = content.replace(ANCHOR, REPLACEMENT, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS')
else:
    print('ANCHOR NOT FOUND')
    sys.exit(1)
