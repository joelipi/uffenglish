export const VideoShareUI = {
    showAlert(message) {
        if (typeof alert !== 'undefined') {
            alert(message);
        } else {
            console.warn('Alert:', message);
        }
    },

    canShareFiles(data) {
        if (typeof navigator !== 'undefined' && navigator.canShare) {
            return navigator.canShare(data);
        }
        return false;
    },

    async shareFiles(data) {
        if (typeof navigator !== 'undefined' && navigator.share) {
            return await navigator.share(data);
        }
        throw new Error('Web Share API not supported');
    },

    createObjectURL(blob) {
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
            return URL.createObjectURL(blob);
        }
        return null;
    },

    revokeObjectURL(url) {
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
            URL.revokeObjectURL(url);
        }
    },

    async downloadFile(url, filename) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
            const blob = await resp.blob();
            const dlUrl = this.createObjectURL(blob);
            if (!dlUrl) {
                console.error('Cannot create Object URL for downloading');
                return;
            }

            if (typeof document !== 'undefined') {
                const a = document.createElement('a');
                a.href = dlUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => this.revokeObjectURL(dlUrl), 10000);
            } else {
                console.warn(`Environment does not support DOM download. Download URL: ${dlUrl}`);
            }
        } catch (e) {
            console.error('Download failed', e);
            throw e;
        }
    }
};
