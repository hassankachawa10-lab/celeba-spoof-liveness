import json
import cv2
import os
import time
import sys

import logging

import numpy as np



#================================================================================
# Path configuration with intelligent fallback
base_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(base_dir)

LOCAL_ROOT = './'
LOCAL_IMAGE_LIST_PATH = 'metas/intra_test/test_label.json'

def resolve_label_path():
    candidate_paths = [
        (LOCAL_ROOT, LOCAL_IMAGE_LIST_PATH),
        (project_dir, LOCAL_IMAGE_LIST_PATH),
        (base_dir, LOCAL_IMAGE_LIST_PATH),
        (os.path.join(project_dir, 'sample_data'), 'metas/intra_test/test_label.json'),
        (os.path.join(base_dir, 'sample_data'), 'metas/intra_test/test_label.json'),
    ]
    for root, rel in candidate_paths:
        full = os.path.join(root, rel)
        if os.path.exists(full):
            return root, rel
    return LOCAL_ROOT, LOCAL_IMAGE_LIST_PATH

#================================================================================


def read_image(image_path):
    """
    Read an image from input path

    params:
        - image_local_path (str): the path of image.
    return:
        - image: Required image.
    """
    root, _ = resolve_label_path()
    full_path = os.path.join(root, image_path) if not os.path.isabs(image_path) else image_path
    if not os.path.exists(full_path):
        # try project dir
        if os.path.exists(os.path.join(project_dir, image_path)):
            full_path = os.path.join(project_dir, image_path)

    img = cv2.imread(full_path)
    if img is None:
        raise FileNotFoundError("Image not found: " + full_path)

    real_h, real_w, c = img.shape
    bb_path = os.path.splitext(full_path)[0] + '_BB.txt'

    if os.path.exists(bb_path):
        with open(bb_path, 'r') as f:
            material = f.readline()
            try:
                x, y, w, h, score = material.strip().split(' ')
                w = int(float(w))
                h = int(float(h))
                x = int(float(x))
                y = int(float(y))
                w = int(w * (real_w / 224))
                h = int(h * (real_h / 224))
                x = int(x * (real_w / 224))
                y = int(y * (real_h / 224))

                # Crop face based on its bounding box
                y1 = 0 if y < 0 else y
                x1 = 0 if x < 0 else x 
                y2 = real_h if y1 + h > real_h else y + h
                x2 = real_w if x1 + w > real_w else x + w
                if y2 > y1 and x2 > x1:
                    img = img[y1:y2, x1:x2, :]
            except Exception as e:
                logging.info(f"Could not crop bounding box for {full_path}: {e}")
    else:
        # Bounding box not supplied; use whole image
        pass

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img



def get_image(max_number=None):
    """
    This function returns a iterator of image.
    It is used for local test of participating algorithms.
    Each iteration provides a tuple of (image_id, image), each image will be in RGB color format with array shape of (height, width, 3)
    
    return: tuple(image_id: str, image: numpy.array)
    """
    root, rel_path = resolve_label_path()
    label_file = os.path.join(root, rel_path)
    if not os.path.exists(label_file):
        raise FileNotFoundError(
            f"Label list file not found at: {label_file}. "
            "Please ensure CelebA-Spoof dataset is configured or sample_data is available."
        )

    with open(label_file, 'r') as f:
        image_list = json.load(f)
    logging.info("got local image list, {} image(s)".format(len(image_list.keys())))
    Batch_size = 1024
    logging.info("Batch_size= {}".format(Batch_size))
    n = 0
    final_image = []
    final_image_id = []
    for idx, image_id in enumerate(image_list):
        # get image from local file
        try:
            image = read_image(image_id)
            final_image.append(image)
            final_image_id.append(image_id)
            n += 1
        except:
            logging.info("Failed to read image: {}".format(image_id))
            raise

        if n == Batch_size or idx == len(image_list) - 1:
            np_final_image_id = np.array(final_image_id)
            try:
                np_final_image = np.array(final_image)
            except (ValueError, np.exceptions.VisibleDeprecationWarning if hasattr(np, 'exceptions') else Exception):
                np_final_image = final_image
            n = 0
            final_image = []
            final_image_id = []
            yield np_final_image_id, np_final_image


#Get the threshold under several fpr
def get_thresholdtable_from_fpr(scores,labels, fpr_list):
    """Calculate the threshold score list from the FPR list

    Args:
      score_target: list of (score,label)

    Returns:
      threshold_list: list, the element is threshold score calculated by the
      corresponding fpr
    """
    threshold_list = []
    live_scores = []
    for score, label in zip(scores,labels):
        if label == 0:
            live_scores.append(float(score))
    live_scores.sort(reverse=True)
    live_nums = len(live_scores)
    for fpr in fpr_list:
        if live_nums > 0:
            i_sample = int(fpr * live_nums)
            i_sample = max(1, min(i_sample, live_nums))
            threshold_list.append(live_scores[i_sample - 1])
        else:
            threshold_list.append(0.5)
    return threshold_list

#Get the threshold under thresholds
def get_tpr_from_threshold(scores,labels, threshold_list):
    """Calculate the recall score list from the threshold score list.

    Args:
      score_target: list of (score,label)
      threshold_list: list, the threshold list

    Returns:
      recall_list: list, the element is recall score calculated by the
                   correspond threshold
    """
    tpr_list = []
    hack_scores = []
    for score, label in zip(scores,labels):
        if label == 1:
            hack_scores.append(float(score))
    hack_scores.sort(reverse=True)
    hack_nums = len(hack_scores)
    for threshold in threshold_list:
        hack_index = 0
        while hack_index < hack_nums:
            if hack_scores[hack_index] <= threshold:
                break
            else:
                hack_index += 1
        if hack_nums != 0:
            tpr = hack_index * 1.0 / hack_nums
        else:
            tpr = 0
        tpr_list.append(tpr)
    return tpr_list



def verify_output(output_probs):
    """
    This function prints the groundtruth and prediction for the participant to verify, calculates average FPS.

    params:
    - output_probs (dict): dict of probability of every video
    - output_times (dict): dict of processing time of every video
    - num_frames (dict): dict of number of frames extracting from every video
    """
    root, rel_path = resolve_label_path()
    with open(os.path.join(root, rel_path), 'r') as f:
        gts = json.load(f)

    scores = []
    labels = []
    for k in output_probs:
        #import pdb;pdb.set_trace()
        if k in gts:
            scores.append(output_probs[k])
            # 43 is the index of Live/Spoof label
            labels.append(gts[k][43])

    fpr_list = [0.01, 0.005, 0.001]
    threshold_list = get_thresholdtable_from_fpr(scores,labels, fpr_list)
    tpr_list = get_tpr_from_threshold(scores,labels, threshold_list)
      
    # Show the result into score_path/score.txt  
    logging.info('TPR@FPR=10E-3: {}\n'.format(tpr_list[0]))
    logging.info('TPR@FPR=5E-3: {}\n'.format(tpr_list[1]))
    logging.info('TPR@FPR=10E-4: {}\n'.format(tpr_list[2]))

    logging.info("Done")


