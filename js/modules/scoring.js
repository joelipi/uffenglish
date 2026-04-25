// modules/scoring.js

export function calculateRepeatAverage(repeatPointsHistory) {
    if (!repeatPointsHistory || repeatPointsHistory.length === 0) return 0;
    const sum = repeatPointsHistory.reduce((a, b) => a + Math.max(0, b), 0);
    return Math.round(sum / repeatPointsHistory.length);
}

export function calculateRolePlayAverage(rolePlayPointsHistory) {
    if (!rolePlayPointsHistory || rolePlayPointsHistory.length === 0) return 0;
    const sum = rolePlayPointsHistory.reduce((a, b) => a + Math.max(0, b), 0);
    return Math.round(sum / rolePlayPointsHistory.length);
}

export function calculateAverage(repeatPointsHistory, rolePlayPointsHistory) {
    const hasRepeat = repeatPointsHistory && repeatPointsHistory.length > 0;
    const hasRolePlay = rolePlayPointsHistory && rolePlayPointsHistory.length > 0;
    
    if (!hasRepeat && !hasRolePlay) return 100;
    if (!hasRepeat) return calculateRolePlayAverage(rolePlayPointsHistory);
    if (!hasRolePlay) return calculateRepeatAverage(repeatPointsHistory);
    
    const sum = calculateRepeatAverage(repeatPointsHistory) + calculateRolePlayAverage(rolePlayPointsHistory);
    return Math.round(sum / 2);
}
