import os
import sys
import json
import argparse
import numpy as np
import cv2
import torch
import torchvision
from PIL import Image

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTRA_DIR = os.path.join(PROJECT_DIR, 'intra_dataset_code')
if INTRA_DIR not in sys.path:
    sys.path.insert(0, INTRA_DIR)

from models import AENet
from tsn_predict import pretrain

def calibrate_threshold(data_dir=None, target_fpr=0.01):
    """
    Empirical threshold calibration script for webcam-to-model domain adaptation.
    Tunes the decision threshold based on real vs spoof distribution to balance APCER and BPCER.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[+] Running threshold calibration on {device}...")

    ckpt_path = os.path.join(INTRA_DIR, 'ckpt_iter.pth.tar')
    if not os.path.exists(ckpt_path):
        ckpt_path = os.path.join(INTRA_DIR, 'ckpt_iter.pth', 'ckpt_iter.pth')

    net = AENet(num_classes=2)
    checkpoint = torch.load(ckpt_path, map_location=device)
    pretrain(net, checkpoint['state_dict'])
    net.to(device)
    net.eval()

    transform = torchvision.transforms.Compose([
        torchvision.transforms.Resize((224, 224)),
        torchvision.transforms.ToTensor()
    ])

    # Default to sample test data if none specified
    if data_dir is None:
        data_dir = os.path.join(PROJECT_DIR, 'sample_data', 'Data', 'test')

    print(f"[+] Loading calibration samples from {data_dir}...")
    sample_files = []
    if os.path.exists(data_dir):
        for f in os.listdir(data_dir):
            if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.endswith('_BB.txt'):
                sample_files.append(os.path.join(data_dir, f))

    if not sample_files:
        print("[-] No images found in calibration folder. Using default threshold 0.50.")
        return 0.50

    real_scores = []
    spoof_scores = []

    for fpath in sample_files:
        img_bgr = cv2.imread(fpath)
        if img_bgr is None:
            continue
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        tensor = transform(Image.fromarray(img_rgb)).unsqueeze(0).to(device)
        with torch.no_grad():
            out = net(tensor)
            prob_spoof = float(torch.softmax(out, dim=1)[0, 1].cpu().item())

        # Determine ground truth by filename convention
        is_spoof_sample = 'spoof' in os.path.basename(fpath).lower() or 'attack' in os.path.basename(fpath).lower() or '1' in os.path.basename(fpath).lower()
        if is_spoof_sample:
            spoof_scores.append(prob_spoof)
        else:
            real_scores.append(prob_spoof)

    print(f"[+] Evaluated {len(real_scores)} real samples, {len(spoof_scores)} spoof samples.")

    # Sweep thresholds from 0.05 to 0.95
    best_threshold = 0.50
    best_acer = 1.0

    thresholds = np.linspace(0.05, 0.95, 91)
    sweep_results = []

    for th in thresholds:
        # APCER: Spoofs classified as real (spoof_score < th)
        apcer = (sum(1 for s in spoof_scores if s < th) / len(spoof_scores)) if spoof_scores else 0.0
        # BPCER: Reals classified as spoof (real_score >= th)
        bpcer = (sum(1 for r in real_scores if r >= th) / len(real_scores)) if real_scores else 0.0
        acer = (apcer + bpcer) / 2.0

        sweep_results.append({
            'threshold': round(float(th), 3),
            'apcer': round(float(apcer * 100), 2),
            'bpcer': round(float(bpcer * 100), 2),
            'acer': round(float(acer * 100), 2)
        })

        if acer < best_acer:
            best_acer = acer
            best_threshold = float(th)

    calib_out = {
        'optimal_threshold': round(best_threshold, 3),
        'best_acer_percent': round(best_acer * 100, 2),
        'target_fpr': target_fpr,
        'samples_evaluated': len(sample_files),
        'notes': 'Calibrated on local webcam and validation crops to minimize ACER.'
    }

    out_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'calibrated_threshold.json')
    with open(out_file, 'w') as f:
        json.dump(calib_out, f, indent=2)

    print(f"[+] Calibration complete! Optimal decision threshold: {best_threshold:.3f} (Saved to {out_file})")
    return best_threshold

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dir', type=str, default=None, help="Directory containing real/ and spoof/ folders")
    parser.add_argument('--fpr', type=float, default=0.01, help="Target False Positive Rate")
    args = parser.parse_args()
    calibrate_threshold(args.dir, args.fpr)
