const text = `1\n00:00:00,500 --> 00:00:03,000\nVamos a hacer un role play de pedir una bebida.\n\n2\n00:00:03,500 --> 00:00:06,000\nTú serás el cliente y yo te venderé la bebida.\n\n3\n00:00:06,500 --> 00:00:10,000\nPrimero vamos a calentar nuestros micrófonos y nuestras bocas. Di: I LOVE ENGLISH!`;

const parsed = [];
const blocks = text.split(/\r?\n\s*\r?\n/);

console.log("Blocks length:", blocks.length);
for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timeLineIndex = lines.findIndex(line => line.indexOf('-->') !== -1);
    console.log("Time line index:", timeLineIndex);
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const textLines = lines.slice(timeLineIndex + 1);
    const textContent = textLines.join('<br>');

    const timeParts = timeLine.split('-->');
    const startStr = timeParts[0].trim();
    const endStr = timeParts[1].trim();

    console.log("Start str:", startStr, "End str:", endStr, "Text:", textContent);
}
