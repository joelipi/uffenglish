import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Renders the statistics table: two tiles per row, and each tile is a single
 * line — icon, label and value on the same row — so it stays a compact strip.
 * Render-only: the stat list (icon, plain-English label, derived value, and
 * the friends tile's quiet link) comes from
 * `src/modules/profile/profile-stats-logic.js`, so the profile pages and the
 * /home dashboard share one definition and one layout.
 */
export default function ProfileStats({ stats }) {
    if (!Array.isArray(stats) || stats.length === 0) return null;
    return (
        <div className="profile-stats-grid" data-testid="profile-stats">
            {stats.map((stat) => {
                const contents = (
                    <>
                        <i className={`bi ${stat.icon}`} aria-hidden="true"></i>
                        <span className="profile-stat-label">{stat.label}</span>
                        <span className="profile-stat-value">{stat.value}</span>
                    </>
                );
                // Only the friends tile is a link (to the friends page). It keeps
                // the tile's own look: no underline and no colour change, so it
                // is not visibly a link.
                if (stat.href) {
                    return (
                        <Link
                            key={stat.id}
                            to={stat.href}
                            className="profile-stat-tile profile-stat-link"
                            data-testid={`profile-stat-${stat.id}`}
                        >
                            {contents}
                        </Link>
                    );
                }
                return (
                    <div key={stat.id} className="profile-stat-tile" data-testid={`profile-stat-${stat.id}`}>
                        {contents}
                    </div>
                );
            })}
        </div>
    );
}
