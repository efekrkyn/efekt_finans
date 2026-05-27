const fs = require('fs');

let manifest = fs.readFileSync('dashboard/public/manifest.json', 'utf8');
manifest = manifest.replace(/Dexter/g, 'Efekt');
fs.writeFileSync('dashboard/public/manifest.json', manifest);

let app = fs.readFileSync('dashboard/src/App.tsx', 'utf8');
app = app.replace(/Dexter/g, 'Efekt');
fs.writeFileSync('dashboard/src/App.tsx', app);

let server = fs.readFileSync('src/server.ts', 'utf8');
server = server.replace(/Dexter/g, 'Efekt');
fs.writeFileSync('src/server.ts', server);

console.log("Replaced Dexter with Efekt");
