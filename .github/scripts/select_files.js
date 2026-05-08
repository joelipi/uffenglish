// .github/scripts/select_files.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';

const apiKey = process.env.GROQ_API_KEY;
const taskDescription = process.env.ISSUE_BODY || "No description provided.";
const fileList = JSON.parse(process.env.FILE_LIST);
const filePaths = fileList.join("\n");

async function callWithRetry(body, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + apiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            const text = await res.text();
            console.log(`GROQ STATUS: ${res.status}`);
            console.log(`GROQ RESPONSE (first 500 chars): ${text.slice(0, 500)}`);
            const data = JSON.parse(text);
            if (!data.choices) throw new Error("No choices in response: " + text.slice(0, 200));
            return data;
        } catch (err) {
            console.log(`Attempt ${i + 1} failed: ${err.message}`);
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function main() {
    const data = await callWithRetry({
        model: "llama-3.3-70b-versatile",
        messages: [
            {
                role: "system",
                content: "You are a code navigation expert. Return ONLY a JSON array of file paths, no explanation, no markdown, no backticks."
            },
            {
                role: "user",
                content: "Given this task:\n" + taskDescription + "\n\nAnd these files:\n" + filePaths + "\n\nReturn a JSON array of the 5-10 most relevant file paths."
            }
        ]
    });

    const raw = data.choices[0].message.content;
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response: " + raw);
    const selectedFiles = JSON.parse(match[0]);
    execSync(`echo 'selected_files=${JSON.stringify(selectedFiles)}' >> $GITHUB_OUTPUT`);
    console.log("Selected files:", selectedFiles);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});