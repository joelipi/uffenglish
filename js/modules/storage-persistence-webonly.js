// @web-only
// Requests persistent browser storage for GECToR NLP models so the browser
// won't auto-delete them under disk pressure.
// Uses navigator.storage — guarded: in React Native navigator.storage is
// undefined so the entire block is a no-op.
export async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        let isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
            isPersisted = await navigator.storage.persist();
        }
        if (isPersisted) {
            console.log("  Storage is persistent. The browser will not auto-delete the GECToR models.");
        } else {
            console.warn("  Persistent storage not granted. Models may be cleared if the device runs low on space.");
        }
    }
}