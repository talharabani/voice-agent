FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN useradd --create-home --shell /bin/bash appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser agent.py gemini_live_agent.py ./

USER appuser

ENV WORKER_ENTRY=gemini_live_agent.py

CMD ["sh", "-c", "exec python ${WORKER_ENTRY:-gemini_live_agent.py} start"]
