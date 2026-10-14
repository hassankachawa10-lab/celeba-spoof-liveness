---
title: Face Anti-Spoofing Liveness Detection
emoji: 🔒
colorFrom: cyan
colorTo: violet
sdk: docker
pinned: false
license: mit
app_port: 7860
---

# CelebA-Spoof Face Anti-Spoofing

Production-quality face liveness detection using **AENet (ResNet-18 Multi-Task)** trained on the CelebA-Spoof dataset.

## Features
- Real-time face detection via MediaPipe
- Live vs Spoof classification with confidence scores
- Spoof type detection (print, screen replay, 3D mask)
- Temporal smoothing across frames
- Glassmorphism dark UI with animated feedback
