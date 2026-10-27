import React from 'react';
import Strings from '../../data/strings.js';

/**
 * Renders the statistics table: two tiles per row, each with the stat's icon,
 * its value and its localized label. Render-only — the stat list (icon, label
 * key, derived value) comes from `src/modules/profile/profile-stats-logic.js`,
 * so the profile, the public share-code page and the /home dashboard share one
 * definition and one compact layout.
 */
export default function ProfileStats({ stats, lang }) {
    if (!Array.isArray(stats) || stats.length === 0) return null;
    return (
        <div className="profile-stats-grid" data-testid="profile-stats">
            {stats.map((stat) => (
                <div
                    key={stat.id}
                    className="profile-stat-tile"
                    data-testid={`profile-stat-${stat.id}`}
                >
                    <i className={`bi ${stat.icon}`} aria-hidden="true"></i>
                    <span className="profile-stat-value">{stat.value}</span>
                    <span className="profile-stat-label">{Strings.get(stat.labelKey, lang)}</span>
                </div>
            ))}
        </div>
    );
}
