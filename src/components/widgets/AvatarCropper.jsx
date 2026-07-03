import React, { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { cropImageToBlob } from '../../modules/avatar/avatar.service.js';

const ASPECT_RATIO = 1080 / 1920;

/**
 * Compute the visible crop area in image pixels at zoom=1 with crop={0,0}.
 * This is the portion of the source image that fits the 9:16 container
 * when the image is contained (no zoom, no panning).
 */
function initialCropAreaPixels(imgW, imgH) {
    const imgAspect = imgW / imgH;
    let w, h;
    if (imgAspect > ASPECT_RATIO) {
        h = imgH;
        w = imgH * ASPECT_RATIO;
    } else {
        w = imgW;
        h = imgW / ASPECT_RATIO;
    }
    return {
        x: (imgW - w) / 2,
        y: (imgH - h) / 2,
        width: w,
        height: h
    };
}

export default function AvatarCropper({ imageSrc, onCropComplete, onCancel }) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    // Seed the initial crop area from image dimensions so the Save button is
    // immediately usable (react-easy-crop's onCropComplete only fires on interaction).
    useEffect(() => {
        if (!imageSrc) return;
        const img = new Image();
        img.onload = () => {
            console.log('[AvatarCropper] Image loaded, computing initial crop:', img.width, 'x', img.height);
            setCroppedAreaPixels(initialCropAreaPixels(img.width, img.height));
        };
        img.onerror = () => {
            console.error('[AvatarCropper] Failed to load image for initial crop');
        };
        img.src = imageSrc;
    }, [imageSrc]);

    const onCropAreaChange = useCallback((_, areaPixels) => {
        setCroppedAreaPixels(areaPixels);
    }, []);

    const handleSave = async () => {
        if (!imageSrc) {
            console.warn('[AvatarCropper] Save called without image');
            return;
        }

        setIsSaving(true);
        try {
            const pixels = croppedAreaPixels || { x: 0, y: 0, width: 1, height: 1 };
            console.log('[AvatarCropper] Cropping image...');
            const blob = await cropImageToBlob(imageSrc, pixels, rotation);
            console.log('[AvatarCropper] Cropping complete, blob size:', blob.size);
            onCropComplete(blob);
        } catch (error) {
            console.error('[AvatarCropper] Failed to crop image:', error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className="avatar-cropper-overlay"
            onClick={onCancel}
        >
            <div
                className="avatar-cropper-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="avatar-cropper-header">
                    <h5 className="m-0">Crop Your Photo</h5>
                </div>

                <div className="avatar-cropper-canvas">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        rotation={rotation}
                        aspect={ASPECT_RATIO}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onRotationChange={setRotation}
                        onCropComplete={onCropAreaChange}
                        cropShape="rect"
                        showGrid={false}
                    />
                </div>

                <div className="avatar-cropper-controls">
                    <label className="avatar-cropper-label">
                        Zoom
                        <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.1}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="form-range"
                        />
                    </label>
                    <label className="avatar-cropper-label">
                        Rotate
                        <input
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={rotation}
                            onChange={(e) => setRotation(Number(e.target.value))}
                            className="form-range"
                        />
                    </label>
                </div>

                <div className="avatar-cropper-actions">
                    <button
                        className="btn btn-outline-light"
                        onClick={onCancel}
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={isSaving || !imageSrc}
                    >
                        {isSaving ? 'Saving...' : 'Accept'}
                    </button>
                </div>
            </div>
        </div>
    );
}
