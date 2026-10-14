import os
import sys
import json
import base64
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add parent directory to path
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from model_service import ModelService
from temporal_filter import TemporalSmoothingFilter
from schemas import PredictionResponse, HealthResponse

model_service: ModelService = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model_service
    print("[+] Starting FastAPI server...")
    # Load model once at startup
    model_service = ModelService.get_instance()
    yield
    print("[-] Shutting down FastAPI server.")

app = FastAPI(
    title="CelebA-Spoof Biometric Anti-Spoofing API",
    version="2.0.0",
    description="Production-quality Face Anti-Spoofing and Liveness Verification backend using AENet",
    lifespan=lifespan
)

# Enable CORS for React/Vite development & production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dist = os.path.join(PROJECT_DIR, "frontend", "dist")
frontend_public = os.path.join(PROJECT_DIR, "frontend", "public")

mediapipe_dir = os.path.join(frontend_dist, "mediapipe")
if not os.path.exists(mediapipe_dir):
    mediapipe_dir = os.path.join(frontend_public, "mediapipe")

if os.path.exists(mediapipe_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/mediapipe", StaticFiles(directory=mediapipe_dir), name="mediapipe")

if os.path.exists(frontend_dist):
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def serve_frontend_root():
        return FileResponse(os.path.join(frontend_dist, "index.html"))

    @app.get("/sample_{name}.jpg")
    async def serve_sample(name: str):
        p1 = os.path.join(frontend_dist, f"sample_{name}.jpg")
        p2 = os.path.join(frontend_public, f"sample_{name}.jpg")
        if os.path.exists(p1):
            return FileResponse(p1)
        if os.path.exists(p2):
            return FileResponse(p2)
        raise HTTPException(status_code=404, detail="Sample not found")

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint confirming model status and hardware device."""
    svc = ModelService.get_instance()
    return HealthResponse(
        status="healthy",
        model_loaded=svc.net is not None,
        device=str(svc.device),
        model_name=svc.model_name
    )

@app.get("/benchmark")
async def get_benchmark():
    """Serves the real empirical benchmark.json dataset evaluations."""
    benchmark_file = os.path.join(PROJECT_DIR, "benchmark.json")
    if not os.path.exists(benchmark_file):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="benchmark.json not found. Run Phase 1 evaluation first."
        )
    with open(benchmark_file, "r") as f:
        data = json.load(f)
    return JSONResponse(content=data)

@app.post("/predict", response_model=PredictionResponse)
async def predict_single_crop(file: UploadFile = File(...)):
    """
    Endpoint for single face crop analysis.
    Images are processed in memory only and never written to disk.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a valid image (JPEG, PNG, WEBP)."
        )

    try:
        image_bytes = await file.read()
        svc = ModelService.get_instance()
        res = svc.predict(image_bytes, is_bytes=True)
        return PredictionResponse(**res)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(e)}"
        )

@app.websocket("/ws")
async def websocket_live_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time live webcam video frames.
    Implements per-connection temporal smoothing across consecutive frames.
    Frames are processed entirely in memory and never stored.
    """
    await websocket.accept()
    svc = ModelService.get_instance()
    temporal_filter = TemporalSmoothingFilter(window_size=6, decay=0.85)

    try:
        while True:
            # Receive frame data (either JSON with base64 'image' or raw bytes)
            message = await websocket.receive_text()
            try:
                data = json.loads(message)
                image_data = data.get("image", "")
                if "," in image_data:
                    image_data = image_data.split(",")[1]
                frame_bytes = base64.b64decode(image_data)
            except Exception:
                # Raw base64 fallback
                if "," in message:
                    message = message.split(",")[1]
                frame_bytes = base64.b64decode(message)

            # In-memory prediction
            raw_res = svc.predict(frame_bytes, is_bytes=True)

            # Apply temporal smoothing across last N frames
            smoothed = temporal_filter.add_frame(
                spoof_prob=raw_res["spoof_probability"],
                spoof_type=raw_res.get("spoof_type")
            )

            # Combine smoothed verdict with raw diagnostic attributes
            response_payload = {
                "label": smoothed["smoothed_label"],
                "is_spoof": smoothed["smoothed_label"] == "spoof",
                "spoof_probability": smoothed["smoothed_spoof_prob"],
                "live_probability": round(1.0 - smoothed["smoothed_spoof_prob"], 4),
                "confidence_percent": smoothed["confidence_percent"],
                "spoof_type": raw_res["spoof_type"] if smoothed["smoothed_label"] == "spoof" else "Authentic Live Face",
                "illumination": raw_res.get("illumination"),
                "latency_ms": raw_res["latency_ms"],
                "model_name": raw_res["model_name"],
                "temporal_frames_count": smoothed["sample_count"],
                "depth_map_base64": raw_res.get("depth_map_base64")
            }

            await websocket.send_text(json.dumps(response_payload))

    except WebSocketDisconnect:
        temporal_filter.reset()
    except Exception as e:
        temporal_filter.reset()
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
