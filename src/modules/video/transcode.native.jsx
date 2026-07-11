// transcode.native.jsx
// Native stubs for the transcode layer. React Native doesn't use WebCodecs or
// the R2 publish path; these throws keep the symbol resolvable so callers
// (importing via ./transcode.js) don't break at build time. The throw surfaces
// any accidental web-only path use during native execution.
export async function transcodeToMp4() {
    throw new Error('transcodeToMp4 not supported on native');
}
export async function uploadWebmToCloudinary() {
    throw new Error('uploadWebmToCloudinary not supported on native');
}
export async function verifyMp4() {
    throw new Error('verifyMp4 not supported on native');
}
