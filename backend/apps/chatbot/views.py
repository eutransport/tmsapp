"""Views for the smart chatbot."""
import logging

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .ai_service import chat
from .models import ChatMessage, ChatSession
from .serializers import (
    ChatInputSerializer,
    ChatMessageSerializer,
    ChatSessionListSerializer,
    ChatSessionSerializer,
)

logger = logging.getLogger(__name__)


class ChatSessionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing chat sessions.

    - GET  /api/chat/sessions/           – list own sessions
    - POST /api/chat/sessions/           – create new session
    - GET  /api/chat/sessions/{id}/      – get session with messages
    - DELETE /api/chat/sessions/{id}/    – delete session

    - POST /api/chat/sessions/{id}/message/ – send a message and get AI reply
    - POST /api/chat/message/                – send a message (creates session if needed)
    """

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ChatSession.objects.filter(user=self.request.user).order_by('-updated_at')

    def get_serializer_class(self):
        if self.action == 'list':
            return ChatSessionListSerializer
        return ChatSessionSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # ------------------------------------------------------------------
    # POST /api/chat/sessions/{id}/message/
    # ------------------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='message')
    def send_message(self, request, pk=None):
        """Send a user message and receive the AI assistant reply."""
        session = self.get_object()
        serializer = ChatInputSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user_text = serializer.validated_data['message']

        # Persist user message
        user_msg = ChatMessage.objects.create(
            session=session,
            role=ChatMessage.Role.USER,
            content=user_text,
        )

        # Build message history for the AI (last 20 messages)
        history = list(
            session.messages.order_by('created_at').values('role', 'content')
        )

        # Call AI
        result = chat(history, user=request.user)

        # Persist assistant reply
        assistant_msg = ChatMessage.objects.create(
            session=session,
            role=ChatMessage.Role.ASSISTANT,
            content=result['content'],
            data=result.get('data'),
        )

        # Auto-title session from first user message
        if not session.title and session.messages.count() <= 2:
            session.title = user_text[:80]
            session.save(update_fields=['title', 'updated_at'])

        return Response({
            'user_message': ChatMessageSerializer(user_msg).data,
            'assistant_message': ChatMessageSerializer(assistant_msg).data,
        })

    # ------------------------------------------------------------------
    # POST /api/chat/message/  (quick send – session optional)
    # ------------------------------------------------------------------

    @action(detail=False, methods=['post'], url_path='message')
    def quick_message(self, request):
        """
        Send a message. Creates a new session if session_id is not provided.
        Returns the updated session and the new messages.
        """
        serializer = ChatInputSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user_text = serializer.validated_data['message']
        session_id = serializer.validated_data.get('session_id')

        # Get or create session
        if session_id:
            try:
                session = ChatSession.objects.get(id=session_id, user=request.user)
            except ChatSession.DoesNotExist:
                return Response(
                    {'error': 'Sessie niet gevonden.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            session = ChatSession.objects.create(user=request.user, title='')

        # Persist user message
        user_msg = ChatMessage.objects.create(
            session=session,
            role=ChatMessage.Role.USER,
            content=user_text,
        )

        # Build message history
        history = list(
            session.messages.order_by('created_at').values('role', 'content')
        )

        # Call AI
        result = chat(history, user=request.user)

        # Persist assistant reply
        assistant_msg = ChatMessage.objects.create(
            session=session,
            role=ChatMessage.Role.ASSISTANT,
            content=result['content'],
            data=result.get('data'),
        )

        # Auto-title session
        if not session.title:
            session.title = user_text[:80]
            session.save(update_fields=['title', 'updated_at'])

        return Response({
            'session_id': str(session.id),
            'session_title': session.title,
            'user_message': ChatMessageSerializer(user_msg).data,
            'assistant_message': ChatMessageSerializer(assistant_msg).data,
        })
