FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY schema ./schema
COPY config ./config
COPY src ./src
COPY tests ./tests
COPY data ./data
COPY README.md ACCEPTANCE_GATES.md INGESTION.md ./
COPY references ./references

CMD ["python3", "-m", "unittest", "discover", "-s", "tests", "-v"]
