// .github/scripts/trigger_jules.js
import fetch from 'node-fetch';
import fs from 'fs';

const token = process.env.GITHUB_TOKEN;
const issueNumber = process.env.ISSUE_NUMBER;
const owner = "joelipi";
const repo = "uffenglish";
const finalSpec = fs.readFileSync('/tmp/final_spec.txt', 'utf8');

async function addComment() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: finalSpec })
    });
    const text = await res.text();
    console.log(`GITHUB COMMENT STATUS: ${res.status}`);
    console.log(`GITHUB COMMENT RESPONSE (first 200 chars): ${text.slice(0, 200)}`);
}

async function addJulesLabel() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ labels: ["jules"] })
    });
    const text = await res.text();
    console.log(`GITHUB LABEL STATUS: ${res.status}`);
    console.log(`GITHUB LABEL RESPONSE (first 200 chars): ${text.slice(0, 200)}`);
}

async function main() {
    await addComment();
    await addJulesLabel();
    console.log(`Done — Jules triggered on issue #${issueNumber}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});