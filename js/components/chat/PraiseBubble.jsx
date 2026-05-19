import React from 'react';

export default function PraiseBubble({ praiseData }) {
    if (!praiseData) return null;

    if (typeof praiseData === 'string') {
        return <span dangerouslySetInnerHTML={{ __html: praiseData }} />;
    }

    if (praiseData.type === 'image') {
        return (
            <img
                src={praiseData.content}
                className="img-fluid rounded"
                alt="Praise"
                style={{ maxHeight: '200px', display: 'block', margin: '0 auto' }}
            />
        );
    }

    return <span>{praiseData.text || ''}</span>;
}
