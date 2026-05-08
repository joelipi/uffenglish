// .github/scripts/generate_spec.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const apiKey = process.env.GROQ_API_KEY;
const issueBody = process.env.ISSUE_BODY || "No description provided.";
const repoContext = fs.readFileSync('/tmp/file_contents.txt', 'utf8');

async function main() {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "moonshotai/kimi-k2-6",
            messages: [
                {
                    role: "system",
                    content: "You are a technical spec writer for Jules, an autonomous AI coding agent that requires exhaustive detail to function correctly. Jules will stall or hallucinate if left to make its own decisions, so your spec must eliminate all ambiguity.\n\nYour spec must:\n1. Name every specific file, function, and module that will be touched\n2. State explicitly what is being replaced, what is being added, and what must remain untouched\n3. Describe every parameter, return value, and data shape for new or modified functions\n4. Specify exact variable names, method signatures, and call sites\n5. Identify every module that imports from or exports to the affected files and describe how those relationships change\n6. Separate all style changes into style.css — never inline styles in JS\n7. Respect separation of concerns — logic in modules, rendering in components, state in store\n8. Every module must be written with a clear adapter boundary so it can be consumed by a future React Native implementation, either directly or via a platform-specific adapter (e.g. module.web.js / module.native.js pattern already in use in this codebase)\n9. Never delete or modify existing code comments or console logs unless the task explicitly requires it\n10. Account for all local-first interactions including UI flow, IndexedDB storage constraints, and offline state handling\n11. Divide the implementation into self-contained sequential steps. Each step must be completable independently without requiring later steps to be done first\n12. For each step include:\n    a. Specific tests covering the most common use cases\n    b. Specific tests covering edge cases and failure modes\n    c. What a passing test looks like and what a failing test looks like\n13. Include a final integration test step that covers the completed implementation end to end and verifies the code runs in the browser against the existing codebase without throwing errors\n14. Every piece of code produced must be verified to run in the browser with the existing codebase — flag any potential conflicts with existing imports, global variables, or event listeners"
                },
                {
                    role: "user",
                    content: "Task:\n" + issueBody + "\n\nRelevant codebase context:\n" + repoContext
                }
            ]
        })
    });

    const data = await response.json();
    const spec = data.choices[0].message.content;

    fs.writeFileSync('/tmp/spec.txt', spec);
    execSync(`echo 'spec=/tmp/spec.txt' >> $GITHUB_OUTPUT`);
    console.log(`Spec generated, ${spec.length} chars`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});