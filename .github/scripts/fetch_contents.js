// .github/scripts/fetch_contents.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const token = process.env.GITHUB_TOKEN;
const owner = "joelipi";
const repo = "uffenglish";
const selectedFiles = JSON.parse(process.env.SELECTED_FILES);

async function main() {
    const fileContents = await Promise.all(
        selectedFiles.map(async (path) => {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            const content = Buffer.from(data.content, "base64").toString("utf8");
            return `### ${path}\n${content}`;
        })
    );

    const combined = fileContents.join("\n\n").slice(0, 15000);

    // Write to a temp file to avoid env var size limits
    fs.writeFileSync('/tmp/file_contents.txt', combined);
    execSync(`echo 'file_contents=/tmp/file_contents.txt' >> $GITHUB_OUTPUT`);
    console.log(`Fetched ${selectedFiles.length} files, ${combined.length} chars total`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});