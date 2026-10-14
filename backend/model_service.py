import os
import sys
import io
import time
import base64
import numpy as np
import cv2
import torch
import torchvision
from PIL import Image
from typing import Dict, Any, Optional

# Ensure intra_dataset_code or model directory is in sys.path
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTRA_DIR = os.path.join(PROJECT_DIR, 'intra_dataset_code')
if INTRA_DIR not in sys.path:
    sys.path.insert(0, INTRA_DIR)

from models import AENet
from tsn_predict import pretrain

ATTACK_NAMES = [
    'Live', 'Photo', 'Poster', 'A4 Paper', 'Face Mask',
    'Upper Body Mask', 'Region Mask', 'PC Monitor', 'Tablet Screen', 'Phone Screen', '3D Mask'
]

ILLUMINATION_NAMES = [
    'Live', 'Normal', 'Strong', 'Backlit', 'Dark'
]

class ModelService:
    """
    Singleton service that loads the AENet model into GPU/CPU memory once on startup
    and executes in-memory face anti-spoofing inference.
    """
    _instance: Optional['ModelService'] = None

    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model_name = "AENet (ResNet-18 Multi-Task)"
        self.checkpoint_name = "ckpt_iter.pth.tar"
        self.decision_threshold = 0.50
        
        # Exact preprocessing pipeline matching training & evaluation
        self.transform = torchvision.transforms.Compose([
            torchvision.transforms.Resize((224, 224)),
            torchvision.transforms.ToTensor()
        ])

        self.net = self._load_model()

    @classmethod
    def get_instance(cls) -> 'ModelService':
        if cls._instance is None:
            cls._instance = ModelService()
        return cls._instance

    def _load_model(self) -> AENet:
        ckpt_path = os.path.join(INTRA_DIR, self.checkpoint_name)
        if not os.path.exists(ckpt_path):
            ckpt_path = os.path.join(INTRA_DIR, 'ckpt_iter.pth', 'ckpt_iter.pth')

        if not os.path.exists(ckpt_path):
            raise FileNotFoundError(f"Model checkpoint not found at: {ckpt_path}")

        print(f"[+] Loading {self.model_name} onto {self.device} from {ckpt_path}...")
        net = AENet(num_classes=2)
        checkpoint = torch.load(ckpt_path, map_location=self.device)
        pretrain(net, checkpoint['state_dict'])
        net.to(self.device)
        net.eval()
        print(f"[+] {self.model_name} loaded successfully and ready.")
        return net

    def preprocess_image_bytes(self, image_bytes: bytes) -> torch.Tensor:
        """
        Process in-memory image bytes (e.g. from upload or webcam frame).
        Never writes image to disk.
        """
        pil_img = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        tensor = self.transform(pil_img).unsqueeze(0).to(self.device)
        return tensor

    def preprocess_cv2_frame(self, bgr_array: np.ndarray) -> torch.Tensor:
        """
        Process in-memory BGR numpy array from OpenCV.
        Converts BGR to RGB and applies identical 224x224 ToTensor transform.
        """
        rgb_array = cv2.cvtColor(bgr_array, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_array)
        tensor = self.transform(pil_img).unsqueeze(0).to(self.device)
        return tensor

    def _encode_depth_map(self, depth_tensor: torch.Tensor) -> Optional[str]:
        try:
            arr = depth_tensor.squeeze().cpu().numpy()
            norm = cv2.normalize(arr, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
            colored = cv2.applyColorMap(norm, cv2.COLORMAP_INFERNO)
            resized = cv2.resize(colored, (112, 112), interpolation=cv2.INTER_CUBIC)
            _, buf = cv2.imencode('.png', resized)
            return base64.b64encode(buf).decode('utf-8')
        except Exception:
            return None

    def predict(self, input_data: Any, is_bytes: bool = True) -> Dict[str, Any]:
        """
        Execute in-memory forward pass with timing.
        """
        t0 = time.perf_counter()

        if is_bytes:
            tensor = self.preprocess_image_bytes(input_data)
        else:
            tensor = self.preprocess_cv2_frame(input_data)

        with torch.no_grad():
            outputs = self.net.forward_all(tensor)
            live_probs = torch.softmax(outputs['live'], dim=1).cpu().numpy()[0]
            attack_probs = torch.softmax(outputs['attack'], dim=1).cpu().numpy()[0]
            light_probs = torch.softmax(outputs['light'], dim=1).cpu().numpy()[0]
            depth_b64 = self._encode_depth_map(outputs['depth_map'])

        latency_ms = (time.perf_counter() - t0) * 1000.0

        live_prob = float(live_probs[0])
        spoof_prob = float(live_probs[1])
        attack_idx = int(np.argmax(attack_probs))
        light_idx = int(np.argmax(light_probs))

        attack_name = ATTACK_NAMES[attack_idx] if attack_idx < len(ATTACK_NAMES) else f"Type {attack_idx}"
        light_name = ILLUMINATION_NAMES[light_idx] if light_idx < len(ILLUMINATION_NAMES) else f"Light {light_idx}"

        # Decision threshold check
        is_spoof = spoof_prob >= self.decision_threshold
        label = "spoof" if is_spoof else "real"
        confidence = spoof_prob if is_spoof else live_prob

        return {
            "label": label,
            "is_spoof": is_spoof,
            "spoof_probability": round(spoof_prob, 4),
            "live_probability": round(live_prob, 4),
            "confidence_percent": round(confidence * 100, 1),
            "spoof_type": attack_name if is_spoof else "Authentic Live Face",
            "illumination": light_name,
            "latency_ms": round(latency_ms, 2),
            "model_name": self.model_name,
            "depth_map_base64": depth_b64
        }
