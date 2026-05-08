// .github/scripts/fetch_files.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const token = process.env.GITHUB_TOKEN;
const owner = "joelipi";
const repo = "uffenglish";
const dirs = ["", "js/modules", "js/components", "js/data", "js/workers"];

async function fetchDir(dir) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${dir}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return data.filter(f => f.type === "file").map(f => f.path);
}

async function main() {
    const allFiles = [];
    for (const dir of dirs) {
        const files = await fetchDir(dir);
        allFiles.push(...files);
    }
    const fileList = JSON.stringify(allFiles);
    execSync(`echo 'file_list=${fileList}' >> $GITHUB_OUTPUT`);
    console.log(`Found ${allFiles.length} files`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});