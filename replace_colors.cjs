const fs = require('fs');
const path = require('path');
const appTsxPath = path.join(__dirname, 'dashboard', 'src', 'App.tsx');
let content = fs.readFileSync(appTsxPath, 'utf8');

// Replacements:
content = content.replace(/'#fff'/g, "'var(--text-main)'");
content = content.replace(/"#fff"/g, '"var(--text-main)"');
content = content.replace(/'#1c1c1c'/g, "'var(--bg-card)'");
content = content.replace(/"#1c1c1c"/g, '"var(--bg-card)"');
content = content.replace(/'#999'/g, "'var(--text-muted)'");
content = content.replace(/"#999"/g, '"var(--text-muted)"');

fs.writeFileSync(appTsxPath, content, 'utf8');
console.log('Colors replaced in App.tsx');
