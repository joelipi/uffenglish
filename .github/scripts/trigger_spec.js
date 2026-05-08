// .github/scripts/trigger_jules.js
import fetch from 'node-fetch';
import fs from 'fs';

const token = process.env.GITHUB_TOKEN;
const issueNumber = process.env.ISSUE_NUMBER;
const owner = "joelipi";
const repo = "uffenglish";
const enrichedSpec = fs.readFileSync('/tmp/enriched_spec.txt', 'utf8');

async function addComment() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            body: enrichedSpec
        })
    });
    const data = await res.json();
    console.log(`Comment added: ${data.html_url}`);
}

async function addJulesLabel() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            labels: ["jules"]
        })
    });
    const data = await res.json();
    console.log(`Jules label added`);
}

async function main() {
    // Post the enriched spec as a comment so Jules has full context
    await addComment();

    // Add the jules label to trigger Jules
    await addJulesLabel();

    console.log(`Done — Jules triggered on issue #${issueNumber}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});