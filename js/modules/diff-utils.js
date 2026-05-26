export function buildGrammarDiffOps(original, corrected) {
    const tokenize = str => str.trim().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?|[^\p{L}\p{N}\s]+|\s+/gu) || [];
    const tokA = tokenize(original), tokB = tokenize(corrected);
    const m = tokA.length, n = tokB.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase() ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const ops = []; let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase()) { ops.unshift({ type: 'eq', val: tokB[j - 1] }); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'ins', val: tokB[j - 1] }); j--; }
        else { ops.unshift({ type: 'del', val: tokA[i - 1] }); i--; }
    }
    return ops;
}

export function renderGrammarDiffHTML(original, corrected) {
    const ops = buildGrammarDiffOps(original || "", corrected || "");
    const isPunct = tok => /^[^\p{L}\p{N}]+$/u.test(tok);
    let userHTML = '', corrHTML = '';
    ops.forEach(({ type, val }) => {
        const v = val.replace(/</g, '&lt;');
        if (type === 'eq') { userHTML += v; corrHTML += v; }
        else if (type === 'del') {
            if (isPunct(val)) { userHTML += v; }
            else { userHTML += `<span class="diff-del">${v}</span>`; }
        }
        else if (type === 'ins') {
            if (isPunct(val)) { corrHTML += v; }
            else { corrHTML += `<span class="diff-ins">${v}</span>`; }
        }
    });
    return { userHTML, corrHTML };
}
