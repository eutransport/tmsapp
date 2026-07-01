# ===========================================
# TMS Backend - Production Dockerfile
# ===========================================
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV DJANGO_SETTINGS_MODULE=tms.settings.production

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    curl \
    # OCR dependencies
    tesseract-ocr \
    tesseract-ocr-nld \
    tesseract-ocr-eng \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements/ /app/requirements/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements/production.txt

# Copy project files
COPY . /app/

# Create necessary directories including fonts, OCR temp and celery-beat schedule
RUN mkdir -p /app/staticfiles /app/media/fonts /app/media/branding /app/media/imports /app/media/temp/ocr /app/logs /app/celerybeat

# Copy entrypoint script and fix line endings (Windows -> Linux)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh

# Create non-root user for security (CVE-2024-21626 mitigation)
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && chown -R app:app /app

# Switch to non-root user
USER app

# Expose port
EXPOSE 8000

# Health check — start-period of 60s gives migrations time to complete on
# first boot; interval and retries then catch runtime failures.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ || exit 1

# Run entrypoint (setup + exec passed command)
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Default command for the web server; overridden in docker-compose for celery
CMD ["gunicorn", \
    "--bind", "0.0.0.0:8000", \
    "--workers", "4", \
    "--threads", "2", \
    "--worker-class", "gthread", \
    "--worker-tmp-dir", "/dev/shm", \
    "--access-logfile", "-", \
    "--error-logfile", "-", \
    "--capture-output", \
    "--limit-request-line", "8190", \
    "--limit-request-fields", "100", \
    "--limit-request-field_size", "8190", \
    "tms.wsgi:application"]
