// .github/scripts/generate_spec.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const apiKey = process.env.DEEPSEEK_API_KEY;
const issueBody = process.env.ISSUE_BODY || "No description provided.";
const repoContext = fs.readFileSync('/tmp/file_contents.txt', 'utf8');

async function callWithRetry(body, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + apiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            const text = await res.text();
            console.log(`DEEPSEEK STATUS: ${res.status}`);
            console.log(`DEEPSEEK RESPONSE (first 500 chars): ${text.slice(0, 500)}`);
            const data = JSON.parse(text);
            if (!data.choices) throw new Error("No choices in response: " + text.slice(0, 200));
            return data;
        } catch (err) {
            console.log(`Attempt ${i + 1} failed: ${err.message}`);
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

async function main() {
    console.log(`File contents loaded: ${repoContext.length} chars`);
    const data = await callWithRetry({
        model: "deepseek-v4-pro",
        messages: [
            {
                role: "system",
                content: "You are a technical spec writer for Jules, an autonomous AI coding agent that requires exhaustive detail to function correctly. Jules will stall or hallucinate if left to make its own decisions, so your prompt to Jules (that is, the spec) must eliminate all ambiguity. Jules will receive the prompt (spec) directly so you should return ONLY the prompt (spec).\n\nDivide the implementation into self-contained sequential steps. Each step must be completable independently.\n\n### 1. Scope & Architecture\n* Name every specific file, function, and module that will be touched.\n* State explicitly what is being replaced, what is being added, and what must remain untouched.\n* Identify every module that imports from or exports to the affected files and describe how those relationships change.\n* Respect separation of concerns: logic in modules, rendering in components, state in store.\n* The existing Vanilla JavaScript web application must be preserved intact; this is NOT a migration to React for the web. Every module must be written with a clear adapter boundary for a future native mobile application (e.g., the module.web.js / module.native.js pattern).\n\n### 2. Code Level Requirements\n* Describe every parameter, return value, and data shape for new or modified functions.\n* Specify exact variable names, method signatures, and call sites.\n* Separate all style changes into style.css — never inline styles in JS.\n* Account for all local-first interactions including UI flow, IndexedDB storage constraints, and offline state handling.\n* Never delete code comments or console logs unless you are specifically instructed to do so OR such comments refer to a block of code which is being deleted.\n\n### 3. Comments, Console Logs, and Debugging\n* Generously comment code to explain why choices were made when that might not be obvious. Also include debug statements and console logs for success conditions.\n\n### 4. Testing & Verification\nFor each sequential step, include:\n* Specific tests covering the most common use cases.\n* Specific tests covering edge cases and failure modes.\n* Clear definitions of what passing and failing tests look like.\n* A final integration test step covering the completed implementation end-to-end.\n* Verification that the code runs in the browser against the existing codebase without throwing errors (flagging any conflicts with existing imports, global variables, or event listeners).\n\n### 5. Formatting & Integrity\n* Be extremely careful that any code examples do not break the markdown file. Ensure all code blocks are properly fenced and avoid unescaped nested backticks that could prematurely terminate the document structure."
            },
            {
                role: "user",
                content: "Task:\n" + issueBody + "\n\nRelevant codebase context:\n" + repoContext
            }
        ]
    });

    const spec = data.choices[0].message.content;
    fs.writeFileSync('/tmp/spec.txt', spec);
    execSync(`echo 'spec=/tmp/spec.txt' >> $GITHUB_OUTPUT`);
    console.log(`Spec generated, ${spec.length} chars`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});