// modules/video/r2-upload-limits.js
// Max bytes per R2 object accepted by functions/api/upload-segment.js.
// Shared by the Function (server guard), the client pre-check, and tests so the
// three cannot drift. 50 MB fits Cloudflare's inbound body limit (100 MB free)
// and R2's 5 GiB single-PUT limit.
export const MAX_R2_UPLOAD_BYTES = 50 * 1024 * 1024;
