"""ViewSets voor de bestandsverkenner: mappen, permissies en bestanden."""
from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils.encoding import smart_str
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .explorer_serializers import (
    FileEntrySerializer,
    FolderDetailSerializer,
    FolderMemberSerializer,
    FolderPermissionSerializer,
    FolderSerializer,
)
from .file_explorer import (
    accessible_folder_ids,
    extract_text,
    filter_files_for_user,
    filter_folders_for_user,
    guess_mime,
    user_can_edit_folder,
    user_can_view_folder,
    user_is_admin,
    validate_upload,
)
from .models import FileEntry, Folder, FolderPermission

logger = logging.getLogger(__name__)
User = get_user_model()


class FolderViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    serializer_class = FolderSerializer

    def get_queryset(self):
        qs = Folder.objects.select_related('created_by', 'parent').all()
        return filter_folders_for_user(qs, self.request.user)

    def get_serializer_class(self):
        if self.action in ('retrieve',):
            return FolderDetailSerializer
        return FolderSerializer

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        parent = request.query_params.get('parent')
        if parent in (None, '', 'null', 'root'):
            qs = qs.filter(parent__isnull=True)
        else:
            try:
                parent_folder = Folder.objects.get(pk=parent)
            except Folder.DoesNotExist:
                return Response({'detail': 'Bovenliggende map niet gevonden.'},
                                status=status.HTTP_404_NOT_FOUND)
            if not user_can_view_folder(request.user, parent_folder):
                return Response({'detail': 'Geen toegang tot deze map.'},
                                status=status.HTTP_403_FORBIDDEN)
            qs = qs.filter(parent=parent_folder)
        qs = qs.order_by('name')
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        folder = self.get_object()
        if not user_can_view_folder(request.user, folder):
            return Response({'detail': 'Geen toegang tot deze map.'},
                            status=status.HTTP_403_FORBIDDEN)
        return Response(self.get_serializer(folder).data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'name': 'Naam is verplicht.'}, status=400)
        parent_id = request.data.get('parent') or None
        parent = None
        if parent_id:
            try:
                parent = Folder.objects.get(pk=parent_id)
            except Folder.DoesNotExist:
                return Response({'parent': 'Bovenliggende map niet gevonden.'}, status=400)
            if not user_can_edit_folder(request.user, parent):
                return Response({'detail': 'Geen rechten om in deze map een submap te maken.'},
                                status=403)
        else:
            # Alleen admins mogen root-mappen aanmaken.
            if not user_is_admin(request.user):
                return Response(
                    {'detail': 'Alleen beheerders mogen mappen in de hoofdmap aanmaken.'},
                    status=403,
                )
        if Folder.objects.filter(parent=parent, name__iexact=name).exists():
            return Response({'name': 'Er bestaat al een map met deze naam op dit niveau.'},
                            status=400)
        folder = Folder.objects.create(name=name[:255], parent=parent, created_by=request.user)
        # Toegangs-lidmaatschappen
        member_ids = request.data.get('member_ids') or []
        can_edit_default = bool(request.data.get('members_can_edit', True))
        if member_ids:
            self._sync_members(folder, member_ids, can_edit_default)
        return Response(FolderDetailSerializer(folder, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        folder = self.get_object()
        if not user_can_edit_folder(request.user, folder):
            return Response({'detail': 'Geen rechten om deze map te wijzigen.'}, status=403)
        name = (request.data.get('name') or folder.name).strip()
        if not name:
            return Response({'name': 'Naam is verplicht.'}, status=400)
        if (Folder.objects.filter(parent=folder.parent, name__iexact=name)
                .exclude(pk=folder.pk).exists()):
            return Response({'name': 'Er bestaat al een map met deze naam op dit niveau.'},
                            status=400)
        folder.name = name[:255]
        folder.save(update_fields=['name', 'updated_at'])
        return Response(FolderDetailSerializer(folder, context={'request': request}).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        folder = self.get_object()
        # Verwijderen alleen door admins of de aanmaker (extra strikt).
        if not (user_is_admin(request.user) or folder.created_by_id == request.user.id):
            return Response({'detail': 'Alleen de aanmaker of een beheerder mag deze map verwijderen.'},
                            status=403)
        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # -- Permissies beheren -------------------------------------------------
    def _sync_members(self, folder: Folder, user_ids, can_edit: bool):
        valid_users = list(User.objects.filter(pk__in=user_ids))
        for u in valid_users:
            FolderPermission.objects.update_or_create(
                folder=folder, user=u, defaults={'can_edit': can_edit},
            )

    @action(detail=True, methods=['get', 'post', 'delete'], url_path='members')
    def members(self, request, pk=None):
        folder = self.get_object()
        if request.method == 'GET':
            if not user_can_view_folder(request.user, folder):
                return Response({'detail': 'Geen toegang.'}, status=403)
            perms = folder.permissions.select_related('user').all()
            return Response(FolderPermissionSerializer(perms, many=True).data)

        # Wijzigen: alleen admin of aanmaker
        if not (user_is_admin(request.user) or folder.created_by_id == request.user.id):
            return Response({'detail': 'Alleen beheerder of aanmaker mag toegang beheren.'},
                            status=403)

        if request.method == 'POST':
            user_ids = request.data.get('user_ids') or []
            can_edit = bool(request.data.get('can_edit', True))
            self._sync_members(folder, user_ids, can_edit)
            perms = folder.permissions.select_related('user').all()
            return Response(FolderPermissionSerializer(perms, many=True).data)

        if request.method == 'DELETE':
            user_id = request.data.get('user_id') or request.query_params.get('user_id')
            if not user_id:
                return Response({'user_id': 'Verplicht.'}, status=400)
            FolderPermission.objects.filter(folder=folder, user_id=user_id).delete()
            return Response(status=204)

    # -- Simpele user-lijst voor de toegangsdialoog -------------------------
    @action(detail=False, methods=['get'], url_path='available-users')
    def available_users(self, request):
        qs = User.objects.filter(is_active=True).order_by('username')[:500]
        return Response(FolderMemberSerializer(qs, many=True).data)


class FileEntryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = FileEntrySerializer

    def get_queryset(self):
        qs = FileEntry.objects.select_related('folder', 'uploaded_by').all()
        return filter_files_for_user(qs, self.request.user)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        folder_param = request.query_params.get('folder')
        query = (request.query_params.get('q') or '').strip()

        if query:
            # Globaal zoeken binnen alles waar deze user bij mag.
            terms = [t for t in query.split() if t]
            for term in terms[:6]:  # bescherming tegen misbruik
                qs = qs.filter(
                    Q(name__icontains=term)
                    | Q(original_filename__icontains=term)
                    | Q(content_text__icontains=term)
                )
        else:
            if folder_param in (None, '', 'null', 'root'):
                qs = qs.filter(folder__isnull=True)
            else:
                try:
                    folder = Folder.objects.get(pk=folder_param)
                except Folder.DoesNotExist:
                    return Response({'detail': 'Map niet gevonden.'}, status=404)
                if not user_can_view_folder(request.user, folder):
                    return Response({'detail': 'Geen toegang tot deze map.'}, status=403)
                qs = qs.filter(folder=folder)

        qs = qs.order_by('name')[:500]
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        entry = self.get_object()
        if not user_can_view_folder(request.user, entry.folder) and not (
            entry.folder is None and entry.uploaded_by_id == request.user.id
        ):
            return Response({'detail': 'Geen toegang.'}, status=403)
        return Response(self.get_serializer(entry).data)

    def create(self, request, *args, **kwargs):
        uploaded = request.FILES.get('file')
        if uploaded is None:
            return Response({'file': 'Bestand is verplicht.'}, status=400)
        try:
            safe_name, ext = validate_upload(uploaded)
        except ValueError as exc:
            return Response({'file': str(exc)}, status=400)

        folder_id = request.data.get('folder') or None
        folder = None
        if folder_id:
            try:
                folder = Folder.objects.get(pk=folder_id)
            except Folder.DoesNotExist:
                return Response({'folder': 'Map niet gevonden.'}, status=400)
            if not user_can_edit_folder(request.user, folder):
                return Response({'detail': 'Geen rechten om in deze map te uploaden.'},
                                status=403)
        else:
            if not user_is_admin(request.user):
                return Response(
                    {'detail': 'Kies een map om naar te uploaden.'},
                    status=400,
                )

        text = extract_text(uploaded, ext)
        try:
            uploaded.seek(0)
        except Exception:
            pass

        entry = FileEntry.objects.create(
            folder=folder,
            name=safe_name,
            original_filename=safe_name,
            file=uploaded,
            size=uploaded.size or 0,
            mime_type=(getattr(uploaded, 'content_type', '') or guess_mime(safe_name))[:127],
            extension=ext[:16],
            content_text=text,
            uploaded_by=request.user,
        )
        return Response(self.get_serializer(entry).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        entry = self.get_object()
        if not (
            user_is_admin(request.user)
            or entry.uploaded_by_id == request.user.id
            or user_can_edit_folder(request.user, entry.folder)
        ):
            return Response({'detail': 'Geen rechten.'}, status=403)
        new_name = (request.data.get('name') or '').strip()
        if new_name:
            from .file_explorer import sanitize_filename
            entry.name = sanitize_filename(new_name)
            entry.save(update_fields=['name', 'updated_at'])
        return Response(self.get_serializer(entry).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        entry = self.get_object()
        if not (
            user_is_admin(request.user)
            or entry.uploaded_by_id == request.user.id
            or user_can_edit_folder(request.user, entry.folder)
        ):
            return Response({'detail': 'Geen rechten om dit bestand te verwijderen.'}, status=403)
        try:
            entry.file.delete(save=False)
        except Exception as exc:
            logger.warning('Kon fysiek bestand niet verwijderen voor %s: %s', entry.id, exc)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        entry = self.get_object()
        if not user_can_view_folder(request.user, entry.folder) and not (
            entry.folder is None and entry.uploaded_by_id == request.user.id
        ):
            return Response({'detail': 'Geen toegang.'}, status=403)
        try:
            fh = entry.file.open('rb')
        except FileNotFoundError as exc:
            logger.warning('Bestand niet gevonden voor %s: %s', entry.id, exc)
            raise Http404('Bestand niet gevonden.')
        response = FileResponse(
            fh,
            as_attachment=request.query_params.get('inline') != '1',
            filename=smart_str(entry.original_filename or entry.name),
            content_type=entry.mime_type or 'application/octet-stream',
        )
        return response

    @action(detail=True, methods=['get'], url_path='preview')
    def preview(self, request, pk=None):
        """Metadata voor de preview-dialog + evt. geëxtraheerde tekst.

        Retourneert JSON: ``{kind, extension, mime_type, name, size, text}``
        waarbij ``kind`` een van ``pdf | image | text | office | other`` is.
        Bestanden zelf worden via ``download/?inline=1`` opgehaald.
        """
        entry = self.get_object()
        if not user_can_view_folder(request.user, entry.folder) and not (
            entry.folder is None and entry.uploaded_by_id == request.user.id
        ):
            return Response({'detail': 'Geen toegang.'}, status=403)
        ext = (entry.extension or '').lower()
        image_exts = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif'}
        text_exts = {'txt', 'md', 'log', 'csv', 'json', 'xml'}
        office_exts = {'docx', 'xlsx', 'xlsm'}
        if ext == 'pdf':
            kind = 'pdf'
        elif ext in image_exts:
            kind = 'image'
        elif ext in text_exts:
            kind = 'text'
        elif ext in office_exts:
            kind = 'office'
        else:
            kind = 'other'
        text = ''
        if kind in ('text', 'office'):
            # Voor .txt/.csv/.md serveren we het bestand zelf (fijner voor grote files
            # en behoudt formatting). Voor Office gebruiken we de geïndexeerde tekst.
            if kind == 'office':
                text = entry.content_text or ''
            else:
                try:
                    with entry.file.open('rb') as fh:
                        raw = fh.read(200_000)  # eerste ~200 KB is genoeg voor preview
                    text = raw.decode('utf-8', errors='ignore')
                except Exception as exc:
                    logger.warning('Kon tekstbestand niet lezen voor %s: %s', entry.id, exc)
        return Response({
            'kind': kind,
            'extension': ext,
            'mime_type': entry.mime_type,
            'name': entry.name,
            'size': entry.size,
            'text': text[:500_000],
        })
