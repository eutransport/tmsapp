"""
File upload validation middleware.

Blocks obviously dangerous file uploads (executables, scripts, HTML with JS)
without requiring changes to individual FileField models or serializers.

Runs on every multipart request that contains files and inspects the extension
plus the first bytes (magic number). Legitimate uploads pass through unchanged.

Tuned conservatively: only blocks a known-bad list so we don't accidentally
reject valid business documents (PDF, XLSX, DOCX, images, CSV, ZIP, etc.).
"""
from __future__ import annotations

import logging
import os
from typing import Iterable

from django.http import JsonResponse

logger = logging.getLogger('accounts.security')

# Extensions we refuse to store — executables, server-side scripts, and web
# content that could run in a browser context if served back.
BLOCKED_EXTENSIONS: frozenset[str] = frozenset({
    # Windows executables / installers
    '.exe', '.dll', '.msi', '.bat', '.cmd', '.com', '.scr', '.cpl',
    '.vbs', '.vbe', '.ps1', '.psm1', '.wsf', '.wsh',
    # Unix executables / scripts
    '.sh', '.bash', '.zsh', '.ksh', '.csh', '.run', '.bin',
    # Server-side / dynamic web
    '.php', '.php3', '.php4', '.php5', '.phtml', '.phar',
    '.jsp', '.jspx', '.asp', '.aspx', '.ashx', '.cshtml',
    # Java
    '.jar', '.war', '.ear', '.class',
    # Web content that browsers could execute. SVG is intentionally allowed —
    # it's a legitimate logo/branding format and is served via <img> which
    # cannot execute embedded scripts.
    '.htm', '.html', '.xhtml',
    '.js', '.mjs', '.jsx', '.ts', '.tsx',
    # Archives that commonly wrap malware installers
    '.iso', '.img', '.dmg',
})

# Magic-byte signatures for known executable/script formats. If the file starts
# with any of these, block even when the extension has been renamed.
BLOCKED_MAGIC: tuple[bytes, ...] = (
    b'MZ',                       # Windows PE (.exe/.dll)
    b'\x7fELF',                  # Linux ELF binary
    b'#!',                       # Shell / Python / Perl script shebang
    b'<?php',                    # Raw PHP source
    b'<%',                       # ASP / JSP tag
)

# Paths where we skip validation entirely — upload endpoints that intentionally
# accept HTML fragments or SVG (add here only if a business feature needs it).
EXEMPT_PATH_PREFIXES: tuple[str, ...] = (
    # Currently none. Add if a legitimate endpoint accepts HTML/SVG.
)


def _looks_dangerous(uploaded_file) -> str | None:
    """Return a human-readable reason if the upload should be blocked, else None."""
    name = (getattr(uploaded_file, 'name', '') or '').lower()
    _, ext = os.path.splitext(name)
    if ext in BLOCKED_EXTENSIONS:
        return f"bestandstype '{ext}' is niet toegestaan"

    # Peek at the first bytes without consuming the stream.
    try:
        head = uploaded_file.read(8)
        uploaded_file.seek(0)
    except Exception:
        # If the file object doesn't support seek, don't fail the request —
        # we already checked the extension.
        return None

    for magic in BLOCKED_MAGIC:
        if head.startswith(magic):
            return "bestandsinhoud lijkt op een uitvoerbaar bestand of script"
    return None


def _iter_files(files) -> Iterable:
    """Yield every uploaded file from a Django MultiValueDict."""
    for key in files:
        for f in files.getlist(key):
            yield f


class FileUploadValidationMiddleware:
    """Reject requests that carry dangerous uploads."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        method = request.method
        if method in ('POST', 'PUT', 'PATCH') and request.FILES:
            path = request.path or ''
            if not any(path.startswith(p) for p in EXEMPT_PATH_PREFIXES):
                for uploaded in _iter_files(request.FILES):
                    reason = _looks_dangerous(uploaded)
                    if reason:
                        logger.warning(
                            "Blocked upload: user=%s path=%s file=%s reason=%s",
                            getattr(getattr(request, 'user', None), 'email', 'anon'),
                            path,
                            getattr(uploaded, 'name', '?'),
                            reason,
                        )
                        return JsonResponse(
                            {'error': f'Upload geweigerd: {reason}.'},
                            status=400,
                        )
        return self.get_response(request)
