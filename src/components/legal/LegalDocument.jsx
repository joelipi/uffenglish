// src/components/legal/LegalDocument.jsx
// Renders a parsed legal markdown document as React elements. Pairs with the
// pure parser in src/modules/legal/markdown.js — this file owns presentation
// only, so a native view could re-implement it (AGENTS.md).
import React from 'react';
import { Link } from 'react-router-dom';
import { parseMarkdown } from '../../modules/legal/markdown.js';

const linkStyle = { color: '#00c0d8', textDecoration: 'underline' };

function renderInline(inlines, keyPrefix) {
    return (inlines || []).map((token, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (token.type) {
            case 'strong':
                return <strong key={key}>{token.value}</strong>;
            case 'em':
                return <em key={key}>{token.value}</em>;
            case 'code':
                return (
                    <code key={key} style={{ background: '#1a3a5a', padding: '1px 5px', borderRadius: '4px', fontSize: '0.9em' }}>
                        {token.value}
                    </code>
                );
            case 'link':
                return /^https?:\/\//.test(token.href)
                    ? <a key={key} href={token.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{token.value}</a>
                    : <Link key={key} to={token.href} style={linkStyle}>{token.value}</Link>;
            default:
                return <React.Fragment key={key}>{token.value}</React.Fragment>;
        }
    });
}

const thStyle = {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '2px solid #2a4a6a',
    color: '#e0e0e0',
    fontSize: '15px',
};

const tdStyle = {
    padding: '10px 12px',
    borderBottom: '1px solid #1a3a5a',
    verticalAlign: 'top',
    fontSize: '15px',
    color: '#cfd8e3',
};

function renderBlock(block, index) {
    const key = `block-${index}`;
    switch (block.type) {
        case 'heading': {
            const common = { color: 'white', lineHeight: 1.3, margin: '28px 0 12px' };
            if (block.level === 1) return <h1 key={key} style={{ ...common, fontSize: '30px' }}>{renderInline(block.inlines, key)}</h1>;
            if (block.level === 2) return <h2 key={key} style={{ ...common, fontSize: '22px' }}>{renderInline(block.inlines, key)}</h2>;
            return <h3 key={key} style={{ ...common, fontSize: '18px' }}>{renderInline(block.inlines, key)}</h3>;
        }
        case 'list':
            return (
                <ul key={key} style={{ margin: '0 0 16px', paddingLeft: '24px' }}>
                    {block.items.map((item, i) => (
                        <li key={`${key}-${i}`} style={{ marginBottom: '8px' }}>{renderInline(item, `${key}-${i}`)}</li>
                    ))}
                </ul>
            );
        case 'table':
            return (
                <div key={key} style={{ overflowX: 'auto', marginBottom: '20px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>{block.header.map((cell, i) => <th key={`${key}-h-${i}`} style={thStyle}>{renderInline(cell, `${key}-h-${i}`)}</th>)}</tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, r) => (
                                <tr key={`${key}-r-${r}`}>
                                    {row.map((cell, c) => <td key={`${key}-r-${r}-${c}`} style={tdStyle}>{renderInline(cell, `${key}-r-${r}-${c}`)}</td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case 'hr':
            return <hr key={key} style={{ border: 'none', borderTop: '1px solid #1a3a5a', margin: '28px 0' }} />;
        default:
            return <p key={key} style={{ margin: '0 0 16px', lineHeight: 1.65 }}>{renderInline(block.inlines, key)}</p>;
    }
}

export default function LegalDocument({ markdown }) {
    const blocks = React.useMemo(() => parseMarkdown(markdown), [markdown]);
    return <>{blocks.map(renderBlock)}</>;
}
