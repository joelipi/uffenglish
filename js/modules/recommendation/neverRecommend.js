import { appStore } from '../store.js';

export function addNeverRecommend(courseId) {
    const state = appStore.getState();
    const current = state.neverRecommendIds || [];
    if (!current.includes(courseId)) {
        appStore.getState().setNeverRecommendIds([...current, courseId]);
    }
}

export async function persistNeverRecommend(courseId) {
    // Stub the endpoint for now
    console.log(`[neverRecommend] Persisting never recommend for ${courseId} to backend (stubbed)`);
    return Promise.resolve(true);
}
