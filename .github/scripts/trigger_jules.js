// .github/scripts/trigger_jules.js
import fetch from 'node-fetch';
import fs from 'fs';

const token = process.env.GITHUB_TOKEN;
const owner = "joelipi";
const repo = "uffenglish";
const issueNumber = process.env.ISSUE_NUMBER;
const finalSpec = fs.readFileSync('/tmp/final_spec.txt', 'utf8');

async function getIssueTitle() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    return data.title;
}

async function createJulesIssue(title, body) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            title: title,
            body: body,
            labels: ["jules"]
        })
    });
    const text = await res.text();
    console.log(`GITHUB CREATE ISSUE STATUS: ${res.status}`);
    console.log(`GITHUB CREATE ISSUE RESPONSE (first 200 chars): ${text.slice(0, 200)}`);
    return JSON.parse(text);
}

async function main() {
    const title = await getIssueTitle();
    console.log(`Creating Jules issue with title: ${title}`);
    const newIssue = await createJulesIssue(title, finalSpec);
    console.log(`Done — Jules issue created: ${newIssue.html_url}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});