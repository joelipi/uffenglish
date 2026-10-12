// Pure formatting helper for homepage titles that carry one inline
// `<i>…</i>` emphasis span (e.g. the UFF expansion title). Splits trusted
// copy into plain/italic segments so the component can render real `<i>`
// elements instead of injecting HTML.

export function splitItalicSegments(text) {
    const input = String(text ?? '');
    const segments = [];
    const pattern = /<i>(.*?)<\/i>/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(input)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ text: input.slice(lastIndex, match.index), italic: false });
        }
        segments.push({ text: match[1], italic: true });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < input.length) {
        segments.push({ text: input.slice(lastIndex), italic: false });
    }
    return segments;
}
