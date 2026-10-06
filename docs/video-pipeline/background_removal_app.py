#!/usr/bin/env python3
"""Modal app for the deployed BiRefNet background-removal function.

This module is the redeploy target for the already-deployed
``video-background-removal`` app (created 2025-11-15). It is deliberately **not**
imported by ``modal_app.py`` or ``video_pipeline.py``: the lesson pipeline calls
the deployed function by name through ``modal.Function.from_name`` so that

    modal deploy docs/video-pipeline/modal_app.py

ships only CPU functions. Modal refuses to deploy a *new* persistent GPU
function without a payment method, and the account already has this one.

Recreate/redeploy the app with::

    modal deploy docs/video-pipeline/background_removal_app.py
"""

from __future__ import annotations

import os
import tempfile

import cv2
import modal
import numpy as np
from PIL import Image

# Same intermediate encoding profile the pipeline uses for the social master.
MASTER_CRF = "16"
MASTER_PRESET = "fast"
MASTER_PIX_FMT = "yuv420p"

bg_app = modal.App("video-background-removal")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch", "torchvision", "transformers", "pillow", "numpy",
        "moviepy", "pydub", "gradio", "einops", "kornia", "timm",
        "opencv-python",
    )
    .apt_install("ffmpeg")
)


@bg_app.function(image=image, gpu="T4", timeout=3600)
def process_video_background_modal(input_video_bytes, background_bytes, is_video_bg,
                                   fps=0, fast_mode=True, max_workers=10):
    from transformers import AutoModelForImageSegmentation
    import torch
    from torchvision import transforms
    from moviepy import VideoFileClip, vfx, ImageSequenceClip
    from concurrent.futures import ThreadPoolExecutor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if fast_mode:
        model = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet_lite", trust_remote_code=True)
    else:
        model = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True)
    model.to(device)

    transform_image = transforms.Compose([
        transforms.Resize((768, 768)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    def process_frame_with_bg(frame, bg_image, model, device):
        import torch.nn.functional as F

        original_h, original_w = frame.shape[:2]
        pil_image = Image.fromarray(frame)
        image_size = pil_image.size
        input_images = transform_image(pil_image).unsqueeze(0).to(device)

        with torch.no_grad():
            preds = model(input_images)[-1].sigmoid().cpu()

        preds = F.interpolate(preds, size=(original_h, original_w), mode='bilinear', align_corners=False)
        pred = preds[0].squeeze().numpy()

        high_conf_mask = (pred > 0.80).astype(np.uint8)
        low_conf_mask = (pred > 0.15).astype(np.uint8)

        contours, _ = cv2.findContours(low_conf_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        final_mask = np.zeros_like(low_conf_mask)
        for contour in contours:
            blob_mask = np.zeros_like(low_conf_mask)
            cv2.drawContours(blob_mask, [contour], -1, 1, thickness=cv2.FILLED)
            if np.logical_and(blob_mask, high_conf_mask).any():
                final_mask = cv2.bitwise_or(final_mask, blob_mask)

        final_mask_tensor = torch.from_numpy(final_mask.astype(np.float32))
        final_mask_tensor = final_mask_tensor.unsqueeze(0).unsqueeze(0)
        final_mask_tensor = F.max_pool2d(final_mask_tensor, kernel_size=5, stride=1, padding=2)
        final_mask_tensor = final_mask_tensor.squeeze()

        pred_pil = transforms.ToPILImage()(final_mask_tensor)
        mask = pred_pil.resize(image_size)

        background = bg_image.convert("RGBA").resize(image_size)
        return np.array(Image.composite(pil_image, background, mask))

    tmp_video_path = tmp_bg_path = output_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_video:
            tmp_video.write(input_video_bytes)
            tmp_video_path = tmp_video.name

        suffix = ".mp4" if is_video_bg else ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_bg:
            tmp_bg.write(background_bytes)
            tmp_bg_path = tmp_bg.name

        video = VideoFileClip(tmp_video_path)
        if fps == 0:
            fps = video.fps
        audio = video.audio
        frames = list(video.iter_frames(fps=fps))

        if is_video_bg:
            background_video = VideoFileClip(tmp_bg_path)
            if background_video.duration < video.duration:
                background_video = background_video.fx(vfx.speedx, factor=video.duration / background_video.duration)
            background_frames = list(background_video.iter_frames(fps=fps))
        else:
            bg_image = Image.open(tmp_bg_path)
            background_frames = [np.array(bg_image)] * len(frames)

        processed_frames = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for i in range(len(frames)):
                bg_frame = background_frames[min(i, len(background_frames) - 1)]
                futures.append(executor.submit(process_frame_with_bg, frames[i], Image.fromarray(bg_frame), model, device))
            for future in futures:
                processed_frames.append(future.result())

        processed_video = ImageSequenceClip(processed_frames, fps=fps).with_audio(audio)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as output_tmp:
            output_path = output_tmp.name
            processed_video.write_videofile(
                output_path,
                codec="libx264",
                audio_codec="aac",
                audio_bitrate="192k",
                preset=MASTER_PRESET,
                ffmpeg_params=[
                    "-crf", MASTER_CRF,
                    "-pix_fmt", MASTER_PIX_FMT,
                    "-movflags", "+faststart",
                ],
            )

        with open(output_path, 'rb') as f:
            return f.read()
    finally:
        for path in (tmp_video_path, tmp_bg_path, output_path):
            if path and os.path.exists(path):
                os.unlink(path)
