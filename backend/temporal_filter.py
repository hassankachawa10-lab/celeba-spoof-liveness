import collections
import numpy as np
from typing import Dict, Any, List

class TemporalSmoothingFilter:
    """
    Temporal smoothing engine to aggregate probabilities across the last N frames.
    Prevents single-frame classification jitter, sensor noise spikes, and flickering.
    """
    def __init__(self, window_size: int = 6, decay: float = 0.85):
        self.window_size = window_size
        self.decay = decay
        self.history: collections.deque = collections.deque(maxlen=window_size)

    def add_frame(self, spoof_prob: float, spoof_type: str = None) -> Dict[str, Any]:
        """
        Add a frame prediction to rolling window and compute smoothed output.
        Uses exponential weighting where newest frames have higher influence.
        """
        self.history.append({
            'spoof_prob': spoof_prob,
            'spoof_type': spoof_type
        })

        n = len(self.history)
        if n == 1:
            return {
                'smoothed_spoof_prob': spoof_prob,
                'smoothed_label': 'spoof' if spoof_prob >= 0.5 else 'real',
                'confidence_percent': round((spoof_prob if spoof_prob >= 0.5 else 1.0 - spoof_prob) * 100, 1),
                'sample_count': 1
            }

        # Calculate exponential weights: decay^(n - 1 - i)
        weights = [self.decay ** (n - 1 - i) for i in range(n)]
        sum_weights = sum(weights)
        norm_weights = [w / sum_weights for w in weights]

        probs = [item['spoof_prob'] for item in self.history]
        weighted_spoof_prob = float(np.sum(np.array(probs) * np.array(norm_weights)))

        # Majority vote check as safety stabilizer
        vote_spoof = sum(1 for p in probs if p >= 0.5)
        majority_spoof = vote_spoof > (n / 2)

        # Final smoothed decision (hysteresis margin)
        is_spoof = weighted_spoof_prob >= 0.48 if majority_spoof else weighted_spoof_prob >= 0.52
        label = 'spoof' if is_spoof else 'real'
        confidence = weighted_spoof_prob if is_spoof else (1.0 - weighted_spoof_prob)

        return {
            'smoothed_spoof_prob': round(weighted_spoof_prob, 4),
            'smoothed_label': label,
            'confidence_percent': round(confidence * 100, 1),
            'sample_count': n
        }

    def reset(self):
        """Reset history when face tracking is lost or restarted."""
        self.history.clear()
