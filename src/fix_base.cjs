const fs = require('fs');
let c = fs.readFileSync('dashboard/src/App.base.tsx', 'utf8');

while (c.startsWith('"') || c.startsWith("'")) {
  try {
    c = JSON.parse(c);
  } catch(e) {
    break;
  }
}
// If it's STILL starting with ", it might be double escaped.
// Let's just do a manual replace if JSON.parse fails.
if (c.startsWith('"')) {
  c = c.substring(1, c.length - 1);
  c = c.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

fs.writeFileSync('dashboard/src/App.base.tsx', c);
console.log('Fixed App.base.tsx formatting');
