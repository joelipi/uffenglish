// .github/scripts/select_files.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const apiKey = process.env.NVIDIA_API_KEY;
const taskDescription = process.env.ISSUE_BODY || "No description provided.";
const fileList = JSON.parse(process.env.FILE_LIST);
const filePaths = fileList.join("\n");

async function main() {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + apiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "stepfun-ai/step-3.5-flash",
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
        })
    });

    const rawResponse = await response.text();
    console.log("API RESPONSE:", rawResponse);
    const data = JSON.parse(rawResponse);
    const raw = data.choices[0].message.content;
    console.log("RAW RESPONSE:", raw);
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response: " + raw);
    const text = match[0];
    const selectedFiles = JSON.parse(text);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});