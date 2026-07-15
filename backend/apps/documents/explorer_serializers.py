"""Serializers voor de bestandsverkenner (mappen, permissies, bestanden)."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Folder, FolderPermission, FileEntry

User = get_user_model()


class FolderMemberSerializer(serializers.ModelSerializer):
    """Compacte user-weergave voor de members-lijst van een map."""
    naam = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'naam', 'username', 'email']

    def get_naam(self, obj):
        full = f"{getattr(obj, 'first_name', '') or ''} {getattr(obj, 'last_name', '') or ''}".strip()
        return full or obj.get_username()


class FolderPermissionSerializer(serializers.ModelSerializer):
    user = FolderMemberSerializer(read_only=True)

    class Meta:
        model = FolderPermission
        fields = ['id', 'user', 'can_edit', 'created_at']
        read_only_fields = ['id', 'created_at']


class FolderSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    file_count = serializers.SerializerMethodField()
    child_count = serializers.SerializerMethodField()

    # Alleen bij het aanmaken/wijzigen doorgegeven vanuit de UI.
    member_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        write_only=True,
    )

    class Meta:
        model = Folder
        fields = [
            'id', 'name', 'parent',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
            'can_edit', 'member_count', 'file_count', 'child_count',
            'member_ids',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    # -- Weergave-helpers --
    def get_created_by_name(self, obj):
        user = obj.created_by
        if not user:
            return None
        full = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
        return full or user.get_username()

    def get_can_edit(self, obj):
        from .file_explorer import user_can_edit_folder
        request = self.context.get('request')
        if not request:
            return False
        return user_can_edit_folder(request.user, obj)

    def get_member_count(self, obj):
        return obj.permissions.count()

    def get_file_count(self, obj):
        return obj.files.count()

    def get_child_count(self, obj):
        return obj.children.count()


class FolderDetailSerializer(FolderSerializer):
    members = FolderPermissionSerializer(source='permissions', many=True, read_only=True)
    ancestors = serializers.SerializerMethodField()

    class Meta(FolderSerializer.Meta):
        fields = FolderSerializer.Meta.fields + ['members', 'ancestors']

    def get_ancestors(self, obj):
        return [{'id': str(a.id), 'name': a.name} for a in obj.get_ancestors()]


class FileEntrySerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()
    folder_name = serializers.CharField(source='folder.name', read_only=True)

    class Meta:
        model = FileEntry
        fields = [
            'id', 'folder', 'folder_name', 'name', 'original_filename',
            'size', 'mime_type', 'extension',
            'uploaded_by', 'uploaded_by_name', 'uploaded_at',
            'download_url',
        ]
        read_only_fields = [
            'id', 'name', 'original_filename', 'size', 'mime_type',
            'extension', 'uploaded_by', 'uploaded_at',
        ]

    def get_uploaded_by_name(self, obj):
        user = obj.uploaded_by
        if not user:
            return None
        full = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
        return full or user.get_username()

    def get_download_url(self, obj):
        request = self.context.get('request')
        # Altijd via authenticated endpoint, NOOIT direct /media/.
        rel = f"/api/documents/files/{obj.id}/download/"
        if request:
            return request.build_absolute_uri(rel)
        return rel
