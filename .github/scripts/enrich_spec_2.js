// .github/scripts/enrich_spec_2.js
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import fs from 'fs';

const apiKey = process.env.DEEPSEEK_API_KEY;
const issueBody = process.env.ISSUE_BODY || "No description provided.";
const enrichedSpec = fs.readFileSync('/tmp/enriched_spec.txt', 'utf8');
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
      return JSON.parse(text);
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function main() {
  const data = await callWithRetry({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are a principal engineer doing a final review of a technical spec before it is handed to Jules, an autonomous AI coding agent. A previous engineer has already enriched the spec with edge cases and error handling. Your job is to do one final pass focusing specifically on:\n\n1. Implementation order — are the steps in the right sequence? Will any step break if done before another?\n2. Missing specificity — are there any instructions Jules could misinterpret or where it would have to guess?\n3. Conflicts — any two parts of the spec that contradict each other\n4. Scope creep — flag anything in the spec that goes beyond what the original task asked for\n5. React Native readiness — confirm every web-specific API has a clearly defined adapter boundary\n6. Test completeness — are the tests for each step actually sufficient to catch regressions?\n\nDo not rewrite the spec. Add a clearly labeled final review section at the end."
      },
      {
        role: "user",
        content: "Original task:\n" + issueBody + "\n\nFull enriched spec:\n" + enrichedSpec + "\n\nCode context:\n" + repoContext
      }
    ]
  });

  const finalSpec = enrichedSpec + "\n\n---\n\n## Final Review Pass\n\n" + data.choices[0].message.content;
  fs.writeFileSync('/tmp/final_spec.txt', finalSpec);
  execSync(`echo 'final_spec=/tmp/final_spec.txt' >> $GITHUB_OUTPUT`);
  console.log(`Final spec generated, ${finalSpec.length} chars`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});