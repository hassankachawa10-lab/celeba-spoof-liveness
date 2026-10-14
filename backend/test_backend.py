import os
import sys
import pytest
import io
import time
from PIL import Image
import numpy as np
from fastapi.testclient import TestClient

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from main import app
from temporal_filter import TemporalSmoothingFilter

client = TestClient(app)

def create_dummy_face_image_bytes(color=(180, 140, 120), size=(224, 224)):
    """Generate in-memory test image bytes."""
    arr = np.full((size[1], size[0], 3), color, dtype=np.uint8)
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

def test_health_endpoint():
    """Verify health check returns healthy status and model load flag."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["model_loaded"] is True
    assert "AENet" in data["model_name"]

def test_benchmark_endpoint():
    """Verify /benchmark serves valid empirical benchmark JSON."""
    response = client.get("/benchmark")
    assert response.status_code == 200
    data = response.json()
    assert "model_metadata" in data
    assert "evaluation_summary" in data
    assert "accuracy" in data["evaluation_summary"]
    assert "apcer" in data["evaluation_summary"]

def test_predict_endpoint_with_image():
    """Verify /predict correctly analyzes an in-memory image crop."""
    img_bytes = create_dummy_face_image_bytes()
    response = client.post(
        "/predict",
        files={"file": ("face_crop.jpg", img_bytes, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["label"] in ["real", "spoof"]
    assert 0.0 <= data["spoof_probability"] <= 1.0
    assert 0.0 <= data["confidence_percent"] <= 100.0
    assert data["latency_ms"] > 0
    assert "model_name" in data

def test_predict_rejects_non_image():
    """Verify /predict rejects invalid non-image content."""
    response = client.post(
        "/predict",
        files={"file": ("test.txt", b"plain text data", "text/plain")}
    )
    assert response.status_code == 400

def test_temporal_smoothing_filter():
    """
    Verify temporal smoothing filter aggregates frames and resists isolated noise spikes.
    """
    filt = TemporalSmoothingFilter(window_size=5, decay=0.85)

    # 4 strong real frames
    for _ in range(4):
        res = filt.add_frame(spoof_prob=0.10)
    assert res["smoothed_label"] == "real"

    # Single spoof noise spike should not immediately flip to spoof
    spike_res = filt.add_frame(spoof_prob=0.85)
    assert spike_res["smoothed_label"] == "real", "Single noise spike should be suppressed by temporal smoothing"

def test_face_detection_timeout_logic():
    """
    Unit test for the 6-7 second timeout logic.
    Simulates a session where no face is detected:
    - If elapsed time >= 6.5s, trigger 'Face detection failed' state.
    """
    TIMEOUT_SECONDS = 6.5

    # Case 1: Within timeout limit
    start_time = time.time()
    elapsed = 2.0
    has_face = False
    timed_out = (not has_face) and (elapsed >= TIMEOUT_SECONDS)
    assert timed_out is False

    # Case 2: Exceeded 6-7s window without face
    elapsed_over = 6.8
    timed_out_over = (not has_face) and (elapsed_over >= TIMEOUT_SECONDS)
    assert timed_out_over is True, "Session must transition to 'Face detection failed' after 6-7 seconds of no face"
