const fs = require('fs');

const lines = fs.readFileSync('/Users/efekarakoyun/.gemini/antigravity/brain/451c1d55-6767-485d-b94d-be640b18515a/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');

for (const line of lines) {
  if (!line) continue;
  try {
    const json = JSON.parse(line);
    if (json.type === 'VIEW_FILE' || json.type === 'GENERIC' || json.type === 'RUN_COMMAND') {
       if (json.content && json.content.includes('Showing lines') && json.content.includes('App.tsx')) {
           console.log("Found view_file for App.tsx at step", json.step_index);
       }
    }
  } catch(e) {}
}
