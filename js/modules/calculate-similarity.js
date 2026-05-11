const calculateSimilarity = (() => {
    function levenshteinDistance(a, b) {
        let tmp;
        let i, j;
        const alen = a.length;
        const blen = b.length;
        const dist = [];

        if (alen === 0) return blen;
        if (blen === 0) return alen;

        for (i = 0; i <= alen; i++) dist[i] = [i];
        for (j = 0; j <= blen; j++) dist[0][j] = j;

        for (i = 1; i <= alen; i++) {
            for (j = 1; j <= blen; j++) {
                tmp = a[i - 1] === b[j - 1] ? 0 : 1;
                dist[i][j] = Math.min(
                    dist[i - 1][j] + 1, // deletion
                    dist[i][j - 1] + 1, // insertion
                    dist[i - 1][j - 1] + tmp // substitution
                );
            }
        }

        return dist[alen][blen];
    }

    function calculateSimilarity(sentence1, sentence2) {
        if (typeof sentence1 !== 'string' || typeof sentence2 !== 'string') {
            throw new Error('Inputs must be strings');
        }

        if (sentence1 === '' && sentence2 === '') {
            return 100;
        }

        const levDist = levenshteinDistance(sentence1, sentence2);
        const maxLen = Math.max(sentence1.length, sentence2.length);
        const similarity = ((maxLen - levDist) / maxLen) * 100;
        return similarity;
    }

    return calculateSimilarity;
})();

export default calculateSimilarity;
