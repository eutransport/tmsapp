"""
Models voor documenten en digitale handtekeningen.
"""
import uuid
import os
from django.db import models
from django.conf import settings


def document_upload_path(instance, filename):
    """Generate upload path for documents."""
    ext = filename.split('.')[-1]
    filename = f"{uuid.uuid4().hex}.{ext}"
    return os.path.join('documents', 'uploads', filename)


def signed_document_path(instance, filename):
    """Generate path for signed documents."""
    ext = filename.split('.')[-1]
    filename = f"{uuid.uuid4().hex}_signed.{ext}"
    return os.path.join('documents', 'signed', filename)


def signature_image_path(instance, filename):
    """Generate path for signature images."""
    ext = filename.split('.')[-1]
    filename = f"{uuid.uuid4().hex}.{ext}"
    return os.path.join('signatures', filename)


class SavedSignature(models.Model):
    """
    Opgeslagen handtekening van een gebruiker.
    Gebruikers kunnen meerdere handtekeningen opslaan voor hergebruik.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='saved_signatures'
    )
    name = models.CharField(max_length=100, verbose_name='Naam')
    signature_image = models.ImageField(
        upload_to=signature_image_path,
        verbose_name='Handtekening afbeelding'
    )
    is_default = models.BooleanField(default=False, verbose_name='Standaard')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Opgeslagen handtekening'
        verbose_name_plural = 'Opgeslagen handtekeningen'
        ordering = ['-is_default', '-created_at']

    def __str__(self):
        return f"{self.name} - {self.user.full_name}"

    def save(self, *args, **kwargs):
        # Zorg dat er maar één default is per gebruiker
        if self.is_default:
            SavedSignature.objects.filter(
                user=self.user, 
                is_default=True
            ).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class SignedDocument(models.Model):
    """
    Een document dat ondertekend moet worden of is.
    """
    STATUS_CHOICES = [
        ('pending', 'Wacht op handtekening'),
        ('signed', 'Ondertekend'),
        ('expired', 'Verlopen'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Origineel document
    title = models.CharField(max_length=255, verbose_name='Titel')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    original_file = models.FileField(
        upload_to=document_upload_path,
        verbose_name='Origineel bestand'
    )
    original_filename = models.CharField(max_length=255, verbose_name='Originele bestandsnaam')
    
    # Ondertekend document
    signed_file = models.FileField(
        upload_to=signed_document_path,
        blank=True,
        null=True,
        verbose_name='Ondertekend bestand'
    )
    
    # Handtekening details
    signature_data = models.JSONField(
        blank=True,
        null=True,
        verbose_name='Handtekening data',
        help_text='JSON met handtekening positie en metadata'
    )
    
    # Status en tracking
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
        verbose_name='Status'
    )
    
    # Gebruikers
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='uploaded_documents',
        verbose_name='Geüpload door'
    )
    signed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='signed_documents',
        verbose_name='Ondertekend door'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    signed_at = models.DateTimeField(null=True, blank=True, verbose_name='Ondertekend op')

    class Meta:
        verbose_name = 'Ondertekend document'
        verbose_name_plural = 'Ondertekende documenten'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    @property
    def file_extension(self):
        if self.original_file:
            return self.original_file.name.split('.')[-1].lower()
        return None

    @property
    def is_pdf(self):
        return self.file_extension == 'pdf'


# ============================================================================
# File Explorer (mappen + bestanden met permissies + full-text index)
# ============================================================================


def file_entry_upload_path(instance, filename):
    """Bestandslocatie voor uploads binnen de file-explorer."""
    ext = filename.split('.')[-1] if '.' in filename else 'bin'
    ext = ext.lower()[:16]
    fname = f"{uuid.uuid4().hex}.{ext}"
    return os.path.join('documents', 'files', fname)


class Folder(models.Model):
    """Map in de bestandsverkenner. Boomstructuur via self-referential parent."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, verbose_name='Naam')
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children',
        verbose_name='Bovenliggende map',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_folders',
        verbose_name='Aangemaakt door',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Map'
        verbose_name_plural = 'Mappen'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['parent', 'name'],
                name='folder_unique_name_per_parent',
            ),
        ]
        indexes = [
            models.Index(fields=['parent']),
        ]

    def __str__(self):
        return self.name

    def get_ancestors(self):
        """Lijst met alle bovenliggende mappen (van root naar direct parent)."""
        ancestors = []
        current = self.parent
        # Bescherming tegen kapotte data
        max_depth = 50
        while current is not None and max_depth > 0:
            ancestors.append(current)
            current = current.parent
            max_depth -= 1
        ancestors.reverse()
        return ancestors

    def path(self) -> str:
        parts = [a.name for a in self.get_ancestors()] + [self.name]
        return '/' + '/'.join(parts)


class FolderPermission(models.Model):
    """Expliciete toegang tot een map voor een gebruiker.

    Admin/superuser hebben altijd toegang, ongeacht deze records.
    De aanmaker van de map heeft ook altijd toegang.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name='permissions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='folder_permissions',
    )
    can_edit = models.BooleanField(
        default=True,
        verbose_name='Mag wijzigen',
        help_text='Bestanden uploaden/verwijderen en submappen aanmaken. Uit = alleen bekijken.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Map-toegang'
        verbose_name_plural = 'Map-toegangen'
        constraints = [
            models.UniqueConstraint(fields=['folder', 'user'], name='folder_permission_unique'),
        ]

    def __str__(self):
        return f"{self.user_id} → {self.folder_id}"


class FileEntry(models.Model):
    """Geüpload bestand in een map (of in de root wanneer folder=NULL)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='files',
        verbose_name='Map',
    )
    name = models.CharField(max_length=255, verbose_name='Weergavenaam')
    original_filename = models.CharField(max_length=255, verbose_name='Originele bestandsnaam')
    file = models.FileField(upload_to=file_entry_upload_path, verbose_name='Bestand')
    size = models.PositiveBigIntegerField(default=0, verbose_name='Grootte (bytes)')
    mime_type = models.CharField(max_length=127, blank=True, verbose_name='MIME-type')
    extension = models.CharField(max_length=16, blank=True, verbose_name='Extensie')
    content_text = models.TextField(
        blank=True,
        verbose_name='Geïndexeerde tekst',
        help_text='Uit het document geëxtraheerde tekst voor zoeken (pdf/docx/xlsx/csv/txt).',
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='uploaded_file_entries',
        verbose_name='Geüpload door',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Bestand'
        verbose_name_plural = 'Bestanden'
        ordering = ['name']
        indexes = [
            models.Index(fields=['folder']),
            models.Index(fields=['extension']),
        ]

    def __str__(self):
        return self.name

