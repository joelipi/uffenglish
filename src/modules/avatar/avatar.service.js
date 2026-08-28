// modules/avatar/avatar.service.js — Supabase Storage version
import { supabase, SUPABASE_CONFIG } from '../api/supabase.js';

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const OUTPUT_MIME_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.92;

const avatarBlobCache = new Map();

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (src && !src.startsWith('blob:')) {
            image.crossOrigin = 'anonymous';
        }
        image.onload = () => resolve(image);
        image.onerror = () => {
            console.error('[Avatar] Failed to load image for cropping:', src?.slice(0, 50));
            reject(new Error('Failed to load image for cropping'));
        };
        image.src = src;
    });
}

function toRadian(degree) {
    return (degree * Math.PI) / 180;
}

export async function cropImageToBlob(imageSrc, pixelCrop, rotation = 0) {
    console.log('[Avatar] Starting cropImageToBlob', { pixelCrop, rotation });
    const image = await loadImage(imageSrc);
    const cropX = Math.round(pixelCrop.x);
    const cropY = Math.round(pixelCrop.y);
    const cropW = Math.round(pixelCrop.width);
    const cropH = Math.round(pixelCrop.height);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    let sourceCanvas = croppedCanvas;
    if (rotation !== 0) {
        const rad = toRadian(rotation);
        const maxSize = Math.max(cropW, cropH);
        const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));
        const safeCanvas = document.createElement('canvas');
        safeCanvas.width = safeArea;
        safeCanvas.height = safeArea;
        const safeCtx = safeCanvas.getContext('2d');
        safeCtx.translate(safeArea / 2, safeArea / 2);
        safeCtx.rotate(rad);
        safeCtx.translate(-safeArea / 2, -safeArea / 2);
        safeCtx.drawImage(croppedCanvas, safeArea / 2 - cropW / 2, safeArea / 2 - cropH / 2);
        const rotatedW = Math.round(Math.abs(cropW * Math.cos(rad)) + Math.abs(cropH * Math.sin(rad)));
        const rotatedH = Math.round(Math.abs(cropW * Math.sin(rad)) + Math.abs(cropH * Math.cos(rad)));
        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = rotatedW;
        rotatedCanvas.height = rotatedH;
        const rotatedCtx = rotatedCanvas.getContext('2d');
        rotatedCtx.drawImage(safeCanvas, safeArea / 2 - rotatedW / 2, safeArea / 2 - rotatedH / 2, rotatedW, rotatedH, 0, 0, rotatedW, rotatedH);
        sourceCanvas = rotatedCanvas;
    }

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = TARGET_WIDTH;
    finalCanvas.height = TARGET_HEIGHT;
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.drawImage(sourceCanvas, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

    return new Promise((resolve, reject) => {
        finalCanvas.toBlob((blob) => {
            if (!blob) { reject(new Error('Canvas toBlob returned null')); return; }
            console.log('[Avatar] Cropped avatar blob ready:', blob.size, 'bytes');
            resolve(blob);
        }, OUTPUT_MIME_TYPE, OUTPUT_QUALITY);
    });
}

export async function uploadAvatarToStorage(blob, userId) {
    console.log('[Avatar] Uploading avatar for user:', userId, 'blob size:', blob.size);
    const fileName = `${userId}/avatar-${Date.now()}.jpg`;
    try {
        console.log('[Avatar] Calling supabase storage upload...');
        const { error } = await supabase.storage.from('avatars').upload(fileName, blob, {
            contentType: OUTPUT_MIME_TYPE,
            upsert: true,
        });
        if (error) throw error;
        console.log('[Avatar] Avatar uploaded successfully:', fileName);
        const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
        console.log('[Avatar] Avatar view URL:', data.publicUrl);
        return data.publicUrl;
    } catch (error) {
        console.error('[Avatar] Avatar upload failed:', error);
        throw error;
    }
}

export async function getAvatarBlobUrl(fileUrl) {
    if (!fileUrl) return null;
    // Public Supabase URLs can be used directly — no fetch needed
    if (fileUrl.includes('supabase.co')) return fileUrl;
    // Legacy Appwrite URLs no longer valid
    if (fileUrl.includes('appwrite.io')) return null;
    if (avatarBlobCache.has(fileUrl)) return avatarBlobCache.get(fileUrl);
    // For any other URL, return as-is (local asset or data URL usage is handled by caller)
    return null;
}

export function revokeAvatarBlobUrl(fileId) {
    const blobUrl = avatarBlobCache.get(fileId);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        avatarBlobCache.delete(fileId);
    }
}

export async function deleteAvatarFromStorage(fileUrl) {
    if (!fileUrl || !fileUrl.includes('supabase.co')) {
        console.log('[Avatar] No Supabase file to delete (URL is local or empty)');
        return;
    }
    // Extract path after /avatars/ 
    const match = fileUrl.match(/\/avatars\/(.+?)(?:\?|$)/);
    if (!match) {
        console.warn('[Avatar] Could not extract file path from URL:', fileUrl);
        return;
    }
    const filePath = match[1];
    console.log('[Avatar] Deleting old avatar file:', filePath);
    try {
        const { error } = await supabase.storage.from('avatars').remove([filePath]);
        if (error) throw error;
        console.log('[Avatar] Old avatar deleted successfully:', filePath);
    } catch (error) {
        console.error('[Avatar] Failed to delete old avatar file:', error);
    }
}
