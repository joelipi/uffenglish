// .github/scripts/enrich_spec.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const apiKey = process.env.NVIDIA_API_KEY;
const issueBody = process.env.ISSUE_BODY || "No description provided.";
const spec = fs.readFileSync('/tmp/spec.txt', 'utf8');

async function main() {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "minimaxai/minimax-m2.5",
            messages: [
                {
                    role: "system",
                    content: "You are a senior engineer reviewing a technical spec that will be handed to Jules, an autonomous AI coding agent. Your job is to enrich the spec — not rewrite it. Add what is missing, make vague parts concrete, and identify bugs and edge cases the original author did not consider.\n\nFocus on:\n1. Missing edge cases — what happens when data is null, empty, malformed, or out of range\n2. Missing error handling — what should happen when a fetch fails, IndexedDB is unavailable, or a module is missing\n3. Race conditions — async operations that could collide or resolve in unexpected order\n4. Browser compatibility — anything that might fail in Safari, Firefox, or older Chrome\n5. Conflicts with existing code — imports, global variables, event listeners, or CSS that could clash\n6. React Native adapter boundaries — flag any web-only APIs (DOM, localStorage, fetch) that will need adapters\n7. Do not remove or rewrite anything from the original spec — only add to it\n8. Do not add new features outside the scope of the original task"
                },
                {
                    role: "user",
                    content: "Original task:\n" + issueBody + "\n\nSpec to enrich:\n" + spec
                }
            ]
        })
    });

    const data = await response.json();
    const enrichedSpec = spec + "\n\n---\n\n## Enrichment Pass — Edge Cases & Bug Prevention\n\n" + data.choices[0].message.content;

    fs.writeFileSync('/tmp/enriched_spec.txt', enrichedSpec);
    execSync(`echo 'enriched_spec=/tmp/enriched_spec.txt' >> $GITHUB_OUTPUT`);
    console.log(`Enriched spec generated, ${enrichedSpec.length} chars`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});