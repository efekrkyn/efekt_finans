const fs = require('fs');

const lines = fs.readFileSync('/Users/efekarakoyun/.gemini/antigravity/brain/451c1d55-6767-485d-b94d-be640b18515a/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const fileLines = {};

for (const line of lines) {
  if (!line) continue;
  try {
    const json = JSON.parse(line);
    if (json.content && json.content.includes('Showing lines') && json.content.includes('App.tsx')) {
       const parts = json.content.split('\n');
       for (const p of parts) {
           const match = p.match(/^(\d+):\s(.*)$/);
           if (match) {
               fileLines[parseInt(match[1])] = match[2];
           }
       }
    }
  } catch(e) {}
}

const maxLine = Math.max(...Object.keys(fileLines).map(Number));
let missing = 0;
let out = '';
for (let i = 1; i <= maxLine; i++) {
   if (fileLines[i] !== undefined) {
       out += fileLines[i] + '\n';
   } else {
       missing++;
       out += `// MISSING LINE ${i}\n`;
   }
}

console.log(`Rebuilt up to ${maxLine} lines. Missing ${missing} lines.`);
fs.writeFileSync('dashboard/src/App.rebuilt.tsx', out);
