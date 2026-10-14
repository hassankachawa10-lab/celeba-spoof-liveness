from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class PredictionResponse(BaseModel):
    label: str = Field(..., description="'real' or 'spoof'")
    is_spoof: bool
    spoof_probability: float = Field(..., ge=0.0, le=1.0)
    live_probability: float = Field(..., ge=0.0, le=1.0)
    confidence_percent: float = Field(..., ge=0.0, le=100.0)
    spoof_type: Optional[str] = Field(None, description="Predicted attack classification")
    illumination: Optional[str] = Field(None, description="Lighting condition")
    latency_ms: float = Field(..., description="Inference time in milliseconds")
    model_name: str
    temporal_smoothed: bool = False
    depth_map_base64: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    device: str
    model_name: str

class ThresholdCalibrationRequest(BaseModel):
    target_fpr: float = Field(0.01, ge=0.0001, le=0.5)

class CalibrationResult(BaseModel):
    calibrated_threshold: float
    target_fpr: float
    message: str
