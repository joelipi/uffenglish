// r2-upload.native.jsx
// Native stub for the R2 upload client. React Native doesn't publish
// segments to R2, so this throws to make any accidental call surface
// loudly during development.
export async function uploadSegmentToR2() {
    throw new Error('uploadSegmentToR2 not supported on native');
}
