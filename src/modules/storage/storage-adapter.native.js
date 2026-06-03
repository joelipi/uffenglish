// modules/storage-adapter.native.js
// React Native stub — AsyncStorage integration comes later.

export const localStore = {
    getItem: (key) => {
        console.warn('[storage-adapter.native] getItem not yet implemented:', key);
        return null;
    },
    setItem: (key, value) => {
        console.warn('[storage-adapter.native] setItem not yet implemented:', key);
    }
};
