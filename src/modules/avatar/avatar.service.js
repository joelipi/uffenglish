// modules/avatar/avatar.service.js
// Avatar upload + client-side crop helpers.
// All Appwrite Storage interaction for profile avatars lives here.

import { storage, APPWRITE_CONFIG, Permission, Role, ID } from '../api/appwrite.js';

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const OUTPUT_MIME_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.92;

// In-memory cache for avatar blob URLs to avoid re-downloading
const avatarBlobCache = new Map();

/**
 * Load an image from a URL/data URL and return an HTMLImageElement.
 * This is a transient canvas operation, not React DOM manipulation.
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // Only set crossOrigin for non-blob URLs (external images)
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

/**
 * Crop and rotate an image according to a pixel crop area (from react-easy-crop)
 * and resize the result to the project's avatar target dimensions (1080x1920).
 *
 * Strategy: extract the selected pixel region from the source image first,
 * then apply rotation to that isolated crop, then resize to final dimensions.
 * This avoids coordinate-transformation bugs between pre-rotate and post-rotate spaces.
 *
 * @param {string} imageSrc - Object URL / data URL of the source image.
 * @param {{x: number, y: number, width: number, height: number}} pixelCrop
 * @param {number} [rotation=0]
 * @returns {Promise<Blob>}
 */
export async function cropImageToBlob(imageSrc, pixelCrop, rotation = 0) {
    console.log('[Avatar] Starting cropImageToBlob', { pixelCrop, rotation });

    const image = await loadImage(imageSrc);

    // 1. Extract the selected region directly from the source image using the
    //    pixel coordinates provided by react-easy-crop (original-image space).
    const cropX = Math.round(pixelCrop.x);
    const cropY = Math.round(pixelCrop.y);
    const cropW = Math.round(pixelCrop.width);
    const cropH = Math.round(pixelCrop.height);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    croppedCtx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // 2. Apply rotation to the extracted crop using a safe-area canvas.
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

        // Extract the tight bounding box of the rotated content.
        const rotatedW = Math.round(Math.abs(cropW * Math.cos(rad)) + Math.abs(cropH * Math.sin(rad)));
        const rotatedH = Math.round(Math.abs(cropW * Math.sin(rad)) + Math.abs(cropH * Math.cos(rad)));

        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = rotatedW;
        rotatedCanvas.height = rotatedH;
        const rotatedCtx = rotatedCanvas.getContext('2d');
        rotatedCtx.drawImage(
            safeCanvas,
            safeArea / 2 - rotatedW / 2,
            safeArea / 2 - rotatedH / 2,
            rotatedW,
            rotatedH,
            0,
            0,
            rotatedW,
            rotatedH
        );

        sourceCanvas = rotatedCanvas;
    }

    // 3. Resize to the final avatar dimensions.
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = TARGET_WIDTH;
    finalCanvas.height = TARGET_HEIGHT;

    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.drawImage(sourceCanvas, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

    // 4. Export as JPEG blob.
    return new Promise((resolve, reject) => {
        finalCanvas.toBlob(
            (blob) => {
                if (!blob) {
                    console.error('[Avatar] canvas.toBlob returned null');
                    reject(new Error('Canvas toBlob returned null'));
                    return;
                }
                console.log('[Avatar] Cropped avatar blob ready:', blob.size, 'bytes');
                resolve(blob);
            },
            OUTPUT_MIME_TYPE,
            OUTPUT_QUALITY
        );
    });
}

/**
 * Upload a cropped avatar blob to Appwrite Storage and return the public view URL.
 *
 * @param {Blob} blob - Cropped avatar blob (JPEG).
 * @param {string} userId - Authenticated Appwrite user ID.
 * @returns {Promise<string>} Public view URL for the uploaded avatar.
 */
export async function uploadAvatarToStorage(blob, userId) {
    console.log('[Avatar] Uploading avatar for user:', userId, 'blob size:', blob.size);

    const file = new File([blob], `avatar-${userId}-${Date.now()}.jpg`, {
        type: OUTPUT_MIME_TYPE
    });

    const fileId = ID.unique();
    const permissions = [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId))
    ];

    try {
        console.log('[Avatar] Calling storage.createFile...');
        const uploadedFile = await storage.createFile({
            bucketId: APPWRITE_CONFIG.AVATAR_BUCKET_ID,
            fileId,
            file,
            permissions
        });

        console.log('[Avatar] Avatar uploaded successfully:', uploadedFile.$id);

        // Return the full view URL (DB column has URL format validation)
        const url = storage.getFileView({
            bucketId: APPWRITE_CONFIG.AVATAR_BUCKET_ID,
            fileId: uploadedFile.$id
        });

        console.log('[Avatar] Avatar view URL:', url);
        return url;
    } catch (error) {
        console.error('[Avatar] Avatar upload failed:', error);
        throw error;
    }
}

/**
 * Get a blob URL for an Appwrite file by downloading it with auth credentials.
 * The browser sends the session cookie with fetch() credentials, unlike <img> tags.
 *
 * @param {string} fileUrl - Full Appwrite Storage file URL
 * @returns {Promise<string|null>} A blob URL for the avatar image
 */
export async function getAvatarBlobUrl(fileUrl) {
    if (!fileUrl || !fileUrl.includes(APPWRITE_CONFIG.ENDPOINT)) return null;

    // In-memory cache to avoid re-downloading
    if (avatarBlobCache.has(fileUrl)) {
        return avatarBlobCache.get(fileUrl);
    }

    try {
        console.log('[Avatar] Downloading avatar via fetch:', fileUrl);
        const response = await fetch(fileUrl, { credentials: 'include' });
        if (!response.ok) {
            console.error('[Avatar] Failed to download avatar:', response.status);
            return null;
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        avatarBlobCache.set(fileUrl, blobUrl);
        console.log('[Avatar] Avatar blob URL created');
        return blobUrl;
    } catch (error) {
        console.error('[Avatar] Failed to download avatar:', error);
        return null;
    }
}

/**
 * Clean up a cached avatar blob URL to free memory.
 */
export function revokeAvatarBlobUrl(fileId) {
    const blobUrl = avatarBlobCache.get(fileId);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        avatarBlobCache.delete(fileId);
    }
}

/**
 * Delete a file from Appwrite Storage by extracting the file ID from its view URL.
 *
 * @param {string} fileUrl - Full Appwrite file view URL.
 * @returns {Promise<void>}
 */
export async function deleteAvatarFromStorage(fileUrl) {
    if (!fileUrl || !fileUrl.includes(APPWRITE_CONFIG.ENDPOINT)) {
        console.log('[Avatar] No old Appwrite file to delete (URL is local or empty)');
        return;
    }

    // Extract file ID from URL pattern: .../files/{fileId}/view or .../files/{fileId}/preview
    const match = fileUrl.match(/\/files\/([a-zA-Z0-9]+)\/(view|preview)/);
    if (!match) {
        console.warn('[Avatar] Could not extract file ID from URL:', fileUrl);
        return;
    }

    const fileId = match[1];
    console.log('[Avatar] Deleting old avatar file:', fileId);

    try {
        await storage.deleteFile({
            bucketId: APPWRITE_CONFIG.AVATAR_BUCKET_ID,
            fileId
        });
        console.log('[Avatar] Old avatar deleted successfully:', fileId);
    } catch (error) {
        console.error('[Avatar] Failed to delete old avatar file:', error);
        // Don't throw — the new upload should still proceed
    }
}
