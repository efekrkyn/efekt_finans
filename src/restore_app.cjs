const fs = require('fs');
const lines = fs.readFileSync('/Users/efekarakoyun/.gemini/antigravity/brain/451c1d55-6767-485d-b94d-be640b18515a/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');

let appContent = fs.readFileSync('dashboard/src/App.base.tsx', 'utf8');

for (const line of lines) {
  if (!line) continue;
  try {
    const json = JSON.parse(line);
    // Ignore edits after step 655 (when the user asked for new features)
    if (json.step_index >= 660) continue; 
    
    if (json.tool_calls) {
        for (const tc of json.tool_calls) {
           if (tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') {
               if (tc.args && tc.args.TargetFile && tc.args.TargetFile.includes('App.tsx')) {
                   const chunks = tc.args.ReplacementChunks || [tc.args];
                   for (const chunk of chunks) {
                       let tcStr = chunk.TargetContent;
                       let rcStr = chunk.ReplacementContent;
                       try { tcStr = JSON.parse(tcStr); } catch(e) {}
                       try { rcStr = JSON.parse(rcStr); } catch(e) {}
                       
                       if (tcStr && rcStr !== undefined) {
                           if (appContent.includes(tcStr)) {
                               appContent = appContent.replace(tcStr, rcStr);
                               console.log(`Applied edit at step ${json.step_index}`);
                           } else {
                               console.log(`Failed to apply edit at step ${json.step_index}`);
                           }
                       }
                   }
               }
           }
        }
    }
  } catch(e) {}
}

fs.writeFileSync('dashboard/src/App.tsx', appContent);
console.log("Restored App.tsx to dashboard/src/App.tsx");
