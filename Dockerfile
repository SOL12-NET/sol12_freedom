FROM python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd -g 10001 appuser && useradd -u 10001 -g appuser -s /usr/sbin/nologin appuser
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ /app/backend/
COPY index.html relays.html relays.json favicon.ico favicon.svg /app/
COPY assets/ /app/assets/
COPY css/ /app/css/
COPY fonts/ /app/fonts/
COPY js/ /app/js/
USER 10001:10001
EXPOSE 8000
# One worker owns the collectors and their in-memory cache.
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
