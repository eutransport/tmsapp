"""
Chatbot models.
Stores chat sessions and message history for the AI assistant.
"""
import uuid
from django.db import models
from django.conf import settings


class ChatSession(models.Model):
    """A conversation session between a user and the AI assistant."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='chat_sessions',
        verbose_name='Gebruiker',
    )
    title = models.CharField(
        max_length=255,
        blank=True,
        default='',
        verbose_name='Titel',
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Aangemaakt op')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Bijgewerkt op')

    class Meta:
        verbose_name = 'Chat sessie'
        verbose_name_plural = 'Chat sessies'
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.user.email} – {self.title or str(self.id)}"


class ChatMessage(models.Model):
    """A single message in a chat session."""

    class Role(models.TextChoices):
        USER = 'user', 'Gebruiker'
        ASSISTANT = 'assistant', 'Assistent'
        SYSTEM = 'system', 'Systeem'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        ChatSession,
        on_delete=models.CASCADE,
        related_name='messages',
        verbose_name='Sessie',
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        verbose_name='Rol',
    )
    content = models.TextField(verbose_name='Inhoud')

    # Optional: store structured data returned by tool calls (e.g. query results)
    data = models.JSONField(null=True, blank=True, verbose_name='Data')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Aangemaakt op')

    class Meta:
        verbose_name = 'Chat bericht'
        verbose_name_plural = 'Chat berichten'
        ordering = ['created_at']

    def __str__(self):
        return f"[{self.role}] {self.content[:80]}"
