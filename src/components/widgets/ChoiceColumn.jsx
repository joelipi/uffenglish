import React from 'react';

// Shared presentational column for the circular call-button decision rows:
// a bilingual label above a caller-supplied control (or controls). Used by both
// the view-and-continue and the simple-response decision rows so their markup
// and bilingual-label handling cannot drift apart.
export default function ChoiceColumn({ label, children }) {
    return (
        <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
            <div className="ivp-choice-label">
                <div className="ivp-choice-label-text">
                    {label.localized ? (
                        <React.Fragment>{label.english}<br /><span lang={label.lang}>{label.localized}</span></React.Fragment>
                    ) : label.english}
                </div>
            </div>
            {children}
        </div>
    );
}
