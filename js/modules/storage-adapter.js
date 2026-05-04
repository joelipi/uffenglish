// modules/storage-adapter.js

// This file exports standard methods. 
// For the web, it uses localStorage. 
// For React Native, it will be swapped out to use AsyncStorage.

export const localStore = {
    getItem: (key) => {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem: (key, value) => {
        try { localStorage.setItem(key, value); } catch (e) { }
    }
};