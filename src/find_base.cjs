const fs = require('fs');
const lines = fs.readFileSync('/Users/efekarakoyun/.gemini/antigravity/brain/451c1d55-6767-485d-b94d-be640b18515a/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');

for (const line of lines) {
  if (!line) continue;
  try {
    const json = JSON.parse(line);
    if (json.tool_calls) {
        for (const tc of json.tool_calls) {
           if (tc.name === 'write_to_file' && tc.args && tc.args.TargetFile && tc.args.TargetFile.includes('App.tsx')) {
               let c = tc.args.CodeContent;
               try { c = JSON.parse(c); } catch(e) {}
               fs.writeFileSync('dashboard/src/App.base.tsx', c);
               console.log("Written to dashboard/src/App.base.tsx");
               process.exit(0);
           }
        }
    }
  } catch(e) {}
}
