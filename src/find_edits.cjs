const fs = require('fs');
const lines = fs.readFileSync('/Users/efekarakoyun/.gemini/antigravity/brain/451c1d55-6767-485d-b94d-be640b18515a/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');

for (const line of lines) {
  if (!line) continue;
  try {
    const json = JSON.parse(line);
    if (json.tool_calls) {
        for (const tc of json.tool_calls) {
           if (tc.name === 'multi_replace_file_content' || tc.name === 'replace_file_content') {
               if (tc.args && tc.args.TargetFile && tc.args.TargetFile.includes('App.tsx')) {
                   console.log("Found edit at step", json.step_index);
                   console.log(tc.args.ReplacementContent || tc.args.ReplacementChunks);
               }
           }
        }
    }
  } catch(e) {}
}
