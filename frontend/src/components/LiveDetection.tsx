import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera, CameraOff, RefreshCw, Zap, ShieldAlert, CheckCircle, 
  AlertTriangle, History, Clock, Cpu, Sliders, Smartphone, Image as ImageIcon,
  HelpCircle, Eye
} from 'lucide-react';
import { PredictionResult, SessionHistoryItem } from '../types';
import { buildWsUrl, apiUrl } from '../config';

declare global {
  interface Window {
    FaceDetection: any;
  }
}

interface LiveDetectionProps {
  wsUrl?: string;
  onPredictionUpdate?: (res: PredictionResult) => void;
}

export const LiveDetection: React.FC<LiveDetectionProps> = ({ 
  wsUrl = buildWsUrl('/ws'),
  onPredictionUpdate
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasOverlayRef = useRef<HTMLCanvasElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // States
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<string>('Initializing camera...');
  const [isFaceInvalid, setIsFaceInvalid] = useState<boolean>(false);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [detectionTimedOut, setDetectionTimedOut] = useState<boolean>(false);
  const [stableFrameCount, setStableFrameCount] = useState<number>(0);
  const [currentResult, setCurrentResult] = useState<PredictionResult | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isDetectorReady, setIsDetectorReady] = useState<boolean>(false);

  // Internal tracking refs to avoid stale closure lags and async frame collisions
  const isCameraActiveRef = useRef<boolean>(false);
  const isProcessingFrameRef = useRef<boolean>(false);
  const lastFaceTimeRef = useRef<number>(Date.now());
  const cameraStartTimeRef = useRef<number>(0);
  const stableCountRef = useRef<number>(0);
  const lastSendTimeRef = useRef<number>(0);
  const animFrameIdRef = useRef<number>(0);
  const currentBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const faceDetectorRef = useRef<any>(null);

  // Connect WebSocket with auto-reconnect
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[+] WebSocket connected to', wsUrl);
      };

      ws.onmessage = (event) => {
        try {
          const data: PredictionResult = JSON.parse(event.data);
          setCurrentResult(data);
          setIsAnalyzing(false);
          if (onPredictionUpdate) onPredictionUpdate(data);

          // Add to session history (capped at 8 items)
          setHistory((prev) => [
            {
              id: Math.random().toString(36).substring(2, 9),
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              label: data.label,
              confidence_percent: data.confidence_percent,
              spoof_type: data.spoof_type || (data.label === 'real' ? 'Authentic Face' : 'Spoof Attack'),
              latency_ms: data.latency_ms
            },
            ...prev.slice(0, 7)
          ]);
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn('[-] WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('[-] WebSocket closed. Will reconnect on next frame.');
        wsRef.current = null;
      };
    } catch (e) {
      console.warn('[-] Failed to create WebSocket:', e);
    }
  }, [wsUrl, onPredictionUpdate]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // Robust MediaPipe Face Detection Initialization with local assets & polling retry
  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    const maxRetries = 60; // Up to 6 seconds polling

    const setupDetector = async () => {
      if (!isMounted) return;

      if (typeof window !== 'undefined' && window.FaceDetection) {
        try {
          console.log('[+] Initializing MediaPipe Face Detection with local assets...');
          const detector = new window.FaceDetection({
            locateFile: (file: string) => `/mediapipe/${file}`
          });
          detector.setOptions({
            model: 'short',
            minDetectionConfidence: 0.45
          });
          detector.onResults(handleMediaPipeResults);
          await detector.initialize();
          if (isMounted) {
            faceDetectorRef.current = detector;
            setIsDetectorReady(true);
            setFaceStatus('Face detector ready — look at camera');
            console.log('[+] MediaPipe Face Detection initialized and ready');
          }
        } catch (err) {
          console.error('[-] MediaPipe initialize error:', err);
          if (retryCount < maxRetries && isMounted) {
            retryCount++;
            setTimeout(setupDetector, 200);
          }
        }
      } else {
        if (retryCount < maxRetries && isMounted) {
          retryCount++;
          setTimeout(setupDetector, 100);
        } else {
          console.warn('[-] window.FaceDetection not found after polling timeout.');
        }
      }
    };

    setupDetector();

    return () => {
      isMounted = false;
      if (faceDetectorRef.current && typeof faceDetectorRef.current.close === 'function') {
        try {
          faceDetectorRef.current.close();
        } catch (e) {}
      }
    };
  }, []);

  // Handle MediaPipe Detections
  const handleMediaPipeResults = (results: any) => {
    const video = videoRef.current;
    const canvas = canvasOverlayRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = Date.now();
    const detections = results.detections || [];

    // Check 1: No Face Detected
    if (detections.length === 0) {
      stableCountRef.current = 0;
      setStableFrameCount(0);
      currentBoxRef.current = null;

      // Check 6-7s timeout
      const elapsedSinceStart = (now - cameraStartTimeRef.current) / 1000;
      const elapsedSinceFace = (now - lastFaceTimeRef.current) / 1000;

      if ((elapsedSinceStart >= 6.5 || elapsedSinceFace >= 6.5) && !detectionTimedOut) {
        setDetectionTimedOut(true);
        setFaceStatus('Face detection failed');
      } else {
        setFaceStatus('Searching for face in frame...');
      }
      setIsFaceInvalid(false);
      setInvalidReason(null);
      return;
    }

    // Reset timeout on face detection
    lastFaceTimeRef.current = now;
    if (detectionTimedOut) setDetectionTimedOut(false);

    // Check 2: Multiple Faces
    if (detections.length > 1) {
      stableCountRef.current = 0;
      setStableFrameCount(0);
      setIsFaceInvalid(true);
      setInvalidReason("Face can't be detected: Multiple faces detected in frame");
      setFaceStatus("Multiple faces detected");
      return;
    }

    // Single Face Detected - Extract normalized bounding box coordinates
    const det = detections[0];
    const bbox = det.boundingBox;
    let w = 0, h = 0, x = 0, y = 0;

    if (typeof bbox.xCenter === 'number' && typeof bbox.yCenter === 'number') {
      w = bbox.width * canvas.width;
      h = bbox.height * canvas.height;
      x = bbox.xCenter * canvas.width - w / 2;
      y = bbox.yCenter * canvas.height - h / 2;
    } else {
      const minX = bbox.xMin ?? bbox.xmin ?? 0;
      const minY = bbox.yMin ?? bbox.ymin ?? 0;
      w = bbox.width * canvas.width;
      h = bbox.height * canvas.height;
      x = minX * canvas.width;
      y = minY * canvas.height;
    }

    // Check 3: Face Size too small (less than ~5% frame area)
    const areaFraction = (w * h) / (canvas.width * canvas.height);
    if (areaFraction < 0.05) {
      stableCountRef.current = 0;
      setStableFrameCount(0);
      setIsFaceInvalid(true);
      setInvalidReason("Face can't be detected: Too far from camera (move closer)");
      setFaceStatus("Face too small");
      return;
    }

    // Check 4: Face partially out of bounds
    if (x < -15 || y < -15 || (x + w) > canvas.width + 15 || (y + h) > canvas.height + 15) {
      stableCountRef.current = 0;
      setStableFrameCount(0);
      setIsFaceInvalid(true);
      setInvalidReason("Face can't be detected: Face partially out of frame");
      setFaceStatus("Face out of bounds");
      return;
    }

    // Check 5: Landmark Occlusion (Hand/Object over face)
    if (det.landmarks && det.landmarks.length >= 4) {
      const rightEye = det.landmarks[0];
      const leftEye = det.landmarks[1];
      const nose = det.landmarks[2];
      const mouth = det.landmarks[3];

      const eyeDist = Math.hypot((leftEye.x - rightEye.x) * canvas.width, (leftEye.y - rightEye.y) * canvas.height);
      const noseToMouth = Math.abs((mouth.y - nose.y) * canvas.height);

      if (eyeDist < w * 0.16 || noseToMouth < h * 0.07) {
        stableCountRef.current = 0;
        setStableFrameCount(0);
        setIsFaceInvalid(true);
        setInvalidReason("Face can't be detected: Hand or object occluding face");
        setFaceStatus("Face occluded");
        return;
      }
    }

    // Smooth bounding box lerp
    if (!currentBoxRef.current) {
      currentBoxRef.current = { x, y, w, h };
    } else {
      const alpha = 0.35;
      currentBoxRef.current = {
        x: currentBoxRef.current.x * (1 - alpha) + x * alpha,
        y: currentBoxRef.current.y * (1 - alpha) + y * alpha,
        w: currentBoxRef.current.w * (1 - alpha) + w * alpha,
        h: currentBoxRef.current.h * (1 - alpha) + h * alpha
      };
    }

    const box = currentBoxRef.current;

    // Draw Smooth Animated Tracking Box on Detected Face (NO static text guide)
    drawTrackingBox(ctx, box.x, box.y, box.w, box.h, currentResult?.label);

    setIsFaceInvalid(false);
    setInvalidReason(null);
    setFaceStatus('Face detected and tracked');

    // Face Stability Tracking
    stableCountRef.current += 1;
    setStableFrameCount(stableCountRef.current);

    // If face is stable for >= 8 frames, trigger model crop extraction
    if (stableCountRef.current >= 8) {
      if (mode === 'auto') {
        // Send at ~6-8 FPS (interval >= 130ms)
        if (now - lastSendTimeRef.current >= 130 && !isAnalyzing) {
          lastSendTimeRef.current = now;
          sendFaceCrop(video, box);
        }
      }
    }
  };

  // Draw dynamic corner tracking brackets & scan reticle
  const drawTrackingBox = (
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    label?: 'real' | 'spoof'
  ) => {
    const isReal = label === 'real';
    const isSpoof = label === 'spoof';

    const color = isReal ? '#10b981' : isSpoof ? '#ef4444' : '#22d3ee';
    const cornerLen = Math.min(bw, bh) * 0.22;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    // Outer subtle box
    ctx.strokeStyle = color + '55';
    ctx.strokeRect(bx, by, bw, bh);

    // Glowing corner brackets
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(bx, by + cornerLen);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + cornerLen, by);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(bx + bw - cornerLen, by);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx + bw, by + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(bx, by + bh - cornerLen);
    ctx.lineTo(bx, by + bh);
    ctx.lineTo(bx + cornerLen, by + bh);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(bx + bw - cornerLen, by + bh);
    ctx.lineTo(bx + bw, by + bh);
    ctx.lineTo(bx + bw, by + bh - cornerLen);
    ctx.stroke();

    ctx.restore();
  };

  // Extract ONLY the face crop (exact crop matching training) and send
  const sendFaceCrop = (video: HTMLVideoElement, box: { x: number; y: number; w: number; h: number }) => {
    let cropCanvas = cropCanvasRef.current;
    if (!cropCanvas) {
      cropCanvas = document.createElement('canvas');
      cropCanvasRef.current = cropCanvas;
    }
    cropCanvas.width = 224;
    cropCanvas.height = 224;

    const ctx = cropCanvas.getContext('2d');
    if (!ctx) return;

    // Strict tight face crop (0 margin to match CelebA-Spoof training crops)
    const sx = Math.max(0, box.x);
    const sy = Math.max(0, box.y);
    const sw = Math.min(video.videoWidth - sx, box.w);
    const sh = Math.min(video.videoHeight - sy, box.h);

    if (sw <= 0 || sh <= 0) return;

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 224, 224);

    const base64Crop = cropCanvas.toDataURL('image/jpeg', 0.92);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setIsAnalyzing(true);
      wsRef.current.send(JSON.stringify({ image: base64Crop }));
    } else {
      // Reconnect if disconnected
      connectWebSocket();
    }
  };

  // Continuous Camera Loop with concurrency lock and ref-based lifetime
  const runCameraLoop = async () => {
    if (!isCameraActiveRef.current || !videoRef.current) return;

    const video = videoRef.current;
    if (video.readyState >= 2 && faceDetectorRef.current && !isProcessingFrameRef.current) {
      isProcessingFrameRef.current = true;
      try {
        await faceDetectorRef.current.send({ image: video });
      } catch (e) {
        console.warn('MediaPipe send frame error:', e);
      } finally {
        isProcessingFrameRef.current = false;
      }
    }

    if (isCameraActiveRef.current) {
      animFrameIdRef.current = requestAnimationFrame(runCameraLoop);
    }
  };

  // Start Camera
  const startCamera = async () => {
    setCameraError(null);
    setDetectionTimedOut(false);
    setIsFaceInvalid(false);
    setInvalidReason(null);
    cameraStartTimeRef.current = Date.now();
    lastFaceTimeRef.current = Date.now();
    stableCountRef.current = 0;
    setStableFrameCount(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          isCameraActiveRef.current = true;
          setIsCameraActive(true);
          cameraStartTimeRef.current = Date.now();
          lastFaceTimeRef.current = Date.now();
          if (animFrameIdRef.current) {
            cancelAnimationFrame(animFrameIdRef.current);
          }
          animFrameIdRef.current = requestAnimationFrame(runCameraLoop);
        };
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Permission denied: Please grant camera access in browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device. You can test using sample files below.');
      } else {
        setCameraError(`Camera error: ${err.message}`);
      }
    }
  };

  // Stop Camera
  const stopCamera = () => {
    isCameraActiveRef.current = false;
    setIsCameraActive(false);
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = 0;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    const canvas = canvasOverlayRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setCurrentResult(null);
    currentBoxRef.current = null;
    stableCountRef.current = 0;
    setStableFrameCount(0);
    setIsFaceInvalid(false);
    setInvalidReason(null);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Manual Trigger
  const handleManualDetect = () => {
    const video = videoRef.current;
    const box = currentBoxRef.current;
    if (video && box) {
      sendFaceCrop(video, box);
    } else {
      alert("No face currently tracked. Please look directly into the camera.");
    }
  };

  // Test with Preset Sample Files (Acceptance Checks 1, 2, 3 verification)
  const handleSampleTest = async (sampleType: 'real' | 'screen' | 'photo') => {
    try {
      setIsAnalyzing(true);
      const filename = sampleType === 'real'
        ? '/sample_0.jpg'
        : sampleType === 'screen'
        ? '/sample_1.jpg'
        : '/sample_spoof.jpg';

      const imgRes = await fetch(filename);
      if (!imgRes.ok) throw new Error(`Could not load sample ${filename}`);
      const blob = await imgRes.blob();

      const formData = new FormData();
      formData.append('file', blob, `${sampleType}.jpg`);

      const res = await fetch(apiUrl('/predict'), {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error(`Inference API error: ${res.statusText}`);
      const data: PredictionResult = await res.json();
      setCurrentResult(data);
      setIsAnalyzing(false);
      if (onPredictionUpdate) onPredictionUpdate(data);

      setHistory((prev) => [
        {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          label: data.label,
          confidence_percent: data.confidence_percent,
          spoof_type: data.spoof_type || (data.label === 'real' ? 'Authentic Face' : 'Spoof Attack'),
          latency_ms: data.latency_ms
        },
        ...prev.slice(0, 7)
      ]);
    } catch (e: any) {
      setIsAnalyzing(false);
      console.error('Sample test error:', e);
      alert(`Sample test error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <div>
            <h2 className="text-sm font-bold text-white">Live Liveness & Anti-Spoofing Detection</h2>
            <p className="text-[11px] text-slate-400 flex items-center gap-2">
              <span>MediaPipe dynamic tracking &bull; AENet ResNet-18</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                isDetectorReady ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}>
                {isDetectorReady ? '⚡ Tracker Ready' : '⏳ Initializing Tracker...'}
              </span>
            </p>
          </div>
        </div>

        {/* Mode Toggle & Actions */}
        <div className="flex items-center gap-3">
          {/* Auto / Manual Toggle */}
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setMode('auto')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                mode === 'auto' ? 'bg-cyan-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Auto (Continuous)</span>
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                mode === 'manual' ? 'bg-cyan-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Manual</span>
            </button>
          </div>

          {/* Camera On / Off Button */}
          {!isCameraActive ? (
            <button
              onClick={startCamera}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition flex items-center gap-2"
            >
              <Camera className="w-4 h-4" />
              <span>Open Camera</span>
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-red-500/20 hover:text-red-300 text-slate-300 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
            >
              <CameraOff className="w-4 h-4" />
              <span>Stop Camera</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Detection Viewport Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Camera Feed & Tracking (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel p-4 rounded-3xl border border-slate-800 relative overflow-hidden shadow-2xl">
            {/* Viewport Frame */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800/80">
              {/* Video Element */}
              <video
                ref={videoRef}
                playsInline
                muted
                className={`w-full h-full object-cover transform -scale-x-100 ${!isCameraActive ? 'hidden' : ''}`}
              />

              {/* Dynamic Tracking Overlay Canvas */}
              <canvas
                ref={canvasOverlayRef}
                className={`absolute inset-0 pointer-events-none transform -scale-x-100 ${!isCameraActive ? 'hidden' : ''}`}
              />

              {/* Camera Off Placeholder */}
              {!isCameraActive && !cameraError && (
                <div className="text-center p-8 space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-cyan-400">
                    <Camera className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Camera Standby</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      Click "Open Camera" to activate automatic face detection and real-time anti-spoofing verification.
                    </p>
                  </div>
                  <button
                    onClick={startCamera}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-600/30"
                  >
                    Activate Camera
                  </button>
                </div>
              )}

              {/* Permission / Hardware Error State */}
              {cameraError && (
                <div className="text-center p-8 space-y-3 max-w-sm">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <h3 className="text-sm font-bold text-red-300">Camera Access Error</h3>
                  <p className="text-xs text-slate-400">{cameraError}</p>
                  <button
                    onClick={startCamera}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white font-semibold transition"
                  >
                    Retry Connection
                  </button>
                </div>
              )}

              {/* Timeout Failure State (No face for 6-7s) */}
              {isCameraActive && detectionTimedOut && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 space-y-3 z-30"
                >
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Clock className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-bold text-white">Face Detection Failed</h4>
                  <p className="text-xs text-slate-300 max-w-xs">
                    No face was found within 6-7 seconds. Please position your face toward the camera.
                  </p>
                  <button
                    onClick={() => {
                      setDetectionTimedOut(false);
                      lastFaceTimeRef.current = Date.now();
                      cameraStartTimeRef.current = Date.now();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:opacity-90 text-white text-xs font-bold transition shadow-lg flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Face Detection</span>
                  </button>
                </motion.div>
              )}

              {/* Invalid Face Reason Banner (Hand/Object, Covered, Too Small, Multiple Faces) */}
              {isCameraActive && isFaceInvalid && (
                <div className="absolute top-4 inset-x-4 bg-amber-500/20 backdrop-blur-md border border-amber-500/40 text-amber-200 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg z-20">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{invalidReason}</span>
                </div>
              )}

              {/* Real-time Stability Counter (Waiting for ~8-10 good frames) */}
              {isCameraActive && stableFrameCount > 0 && stableFrameCount < 8 && !isFaceInvalid && (
                <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 text-[11px] text-cyan-300 font-mono flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>Stabilizing Face: {stableFrameCount}/8 frames</span>
                </div>
              )}
            </div>

            {/* Bottom Actions (Manual Detect Button) */}
            {isCameraActive && mode === 'manual' && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleManualDetect}
                  disabled={stableFrameCount < 5 || isFaceInvalid}
                  className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 transition flex items-center gap-1.5"
                >
                  <Eye className="w-4 h-4" />
                  <span>Detect Crop Now</span>
                </button>
              </div>
            )}
            {/* Quick Benchmark Sample Testing Bar */}
            <div className="mt-4 pt-3 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  Instant Benchmark Sample Tests (No Camera Needed)
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Checks 1-3</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleSampleTest('real')}
                  disabled={isAnalyzing}
                  className="px-2.5 py-2 rounded-xl bg-slate-900/90 hover:bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  <span className="truncate">1. Live Face (Real)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSampleTest('screen')}
                  disabled={isAnalyzing}
                  className="px-2.5 py-2 rounded-xl bg-slate-900/90 hover:bg-red-500/15 border border-red-500/30 text-[11px] font-semibold text-red-300 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0 text-red-400" />
                  <span className="truncate">2. Screen Replay</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSampleTest('photo')}
                  disabled={isAnalyzing}
                  className="px-2.5 py-2 rounded-xl bg-slate-900/90 hover:bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-300 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                  <span className="truncate">3. Printed Photo</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Result Card & Diagnostics (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <AnimatePresence mode="wait">
            {currentResult ? (
              <motion.div
                key={currentResult.label + currentResult.confidence_percent}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
                className={`glass-panel p-6 rounded-3xl border transition-all duration-300 ${
                  currentResult.label === 'real'
                    ? 'border-emerald-500/40 bg-emerald-500/10 shadow-2xl shadow-emerald-500/10'
                    : 'border-red-500/40 bg-red-500/10 shadow-2xl shadow-red-500/10'
                }`}
              >
                {/* Result Hero Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Liveness Verdict
                    </span>
                    <h3
                      className={`text-3xl font-black tracking-tight mt-0.5 ${
                        currentResult.label === 'real' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {currentResult.label === 'real' ? 'REAL FACE' : 'SPOOF DETECTED'}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1">
                      {currentResult.label === 'real'
                        ? 'Authentic live human subject verified.'
                        : `Attack identified: ${currentResult.spoof_type}`}
                    </p>
                  </div>
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                      currentResult.label === 'real'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {currentResult.label === 'real' ? (
                      <CheckCircle className="w-8 h-8" />
                    ) : (
                      <ShieldAlert className="w-8 h-8" />
                    )}
                  </div>
                </div>

                {/* Confidence Bar Meter */}
                <div className="mt-6 pt-4 border-t border-white/10 space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-slate-300">Confidence Score</span>
                      <span
                        className={`font-mono font-bold ${
                          currentResult.label === 'real' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {currentResult.confidence_percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          currentResult.label === 'real' ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${currentResult.confidence_percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Diagnostic Badges */}
                  <div className="grid grid-cols-2 gap-2.5 pt-2">
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Inference Latency</span>
                      <p className="text-xs font-mono font-bold text-cyan-300 mt-0.5">
                        {currentResult.latency_ms.toFixed(1)} ms
                      </p>
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Spoof Category</span>
                      <p className="text-xs font-semibold text-white truncate mt-0.5">
                        {currentResult.spoof_type || 'None'}
                      </p>
                    </div>
                  </div>

                  {/* Pseudo-Depth Map Thumbnail */}
                  {currentResult.depth_map_base64 && (
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 flex items-center gap-3">
                      <div className="w-14 h-14 rounded-lg bg-black overflow-hidden border border-slate-700 shrink-0">
                        <img
                          src={`data:image/png;base64,${currentResult.depth_map_base64}`}
                          alt="Depth Map"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="text-[11px] text-slate-400">
                        <strong className="text-slate-200">AENet 3D Depth Map:</strong> Planar screen replays & photo prints display flat gradient responses.
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              /* Awaiting Detection Empty State */
              <div className="glass-panel p-8 rounded-3xl border border-slate-800 text-center space-y-3 min-h-[340px] flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-bold text-white">Awaiting Detection Data</h4>
                <p className="text-xs text-slate-400 max-w-xs">
                  Turn on the camera to begin automatic facial analysis. The system will distinguish real human presence from spoof attempts.
                </p>
              </div>
            )}
          </AnimatePresence>

          {/* Session History Log */}
          {history.length > 0 && (
            <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 pb-2 border-b border-slate-800">
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Session History ({history.length})</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Recent scans</span>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          item.label === 'real' ? 'bg-emerald-400' : 'bg-red-400'
                        }`}
                      />
                      <span className="font-bold text-white uppercase text-[11px]">{item.label}</span>
                      <span className="text-[11px] text-slate-400 truncate max-w-[120px]">{item.spoof_type}</span>
                    </div>
                    <div className="flex items-center space-x-2 font-mono text-[11px]">
                      <span className="text-slate-300">{item.confidence_percent.toFixed(1)}%</span>
                      <span className="text-slate-500">{item.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
