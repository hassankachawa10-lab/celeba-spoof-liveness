export interface PredictionResult {
  label: 'real' | 'spoof';
  is_spoof: boolean;
  spoof_probability: number;
  live_probability: number;
  confidence_percent: number;
  spoof_type?: string;
  illumination?: string;
  latency_ms: number;
  model_name: string;
  depth_map_base64?: string;
  temporal_frames_count?: number;
}

export interface SessionHistoryItem {
  id: string;
  timestamp: string;
  label: 'real' | 'spoof';
  confidence_percent: number;
  spoof_type: string;
  latency_ms: number;
}

export interface BenchmarkData {
  model_metadata: {
    model_name: string;
    architecture: string;
    framework: string;
    checkpoint_file: string;
    input_resolution: string;
    normalization: string;
    crop_protocol: string;
    decision_threshold: number;
    trained_accuracy_checkpoint: number;
  };
  evaluation_summary: {
    dataset: string;
    total_evaluated_samples: number;
    live_samples: number;
    spoof_samples: number;
    accuracy: number;
    apcer: number;
    bpcer: number;
    acer: number;
    eer: number;
    auc: number;
    tpr_at_fpr_1_0_pct: number;
    tpr_at_fpr_0_5_pct: number;
    tpr_at_fpr_0_1_pct: number;
    latency: {
      device: string;
      mean_ms_per_frame: number;
      std_ms_per_frame: number;
      fps: number;
    };
  };
  spoof_type_breakdown: Record<string, {
    samples: number;
    accuracy: number;
    error_rate: number;
  }>;
  illumination_breakdown: Record<string, {
    samples: number;
    accuracy: number;
    error_rate: number;
  }>;
  full_dataset_protocol_reference: {
    full_dataset_size: string;
    full_dataset_attributes: number;
    note: string;
  };
}
