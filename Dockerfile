# ── base image: slim Python 3.11 ─────────────────────────────────────────────
FROM python:3.11-slim

# System libs needed by opencv-headless & torch
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libgomp1 \
        git \
    && rm -rf /var/lib/apt/lists/*

# ── working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── install Python dependencies ───────────────────────────────────────────────
# Copy requirements first (layer-cache friendly)
COPY requirements.txt .

# Install CPU-only torch to keep image small (avoids ~2GB CUDA wheels)
RUN pip install --no-cache-dir \
        torch==2.1.2+cpu \
        torchvision==0.16.2+cpu \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# ── copy project files ────────────────────────────────────────────────────────
COPY backend/          ./backend/
COPY intra_dataset_code/ ./intra_dataset_code/
COPY model/            ./model/
COPY frontend/dist/    ./frontend/dist/
COPY benchmark.json    ./benchmark.json

# ── expose port 7860 (HF Spaces default) ─────────────────────────────────────
ENV PORT=7860
EXPOSE 7860

# ── launch FastAPI via uvicorn ────────────────────────────────────────────────
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
