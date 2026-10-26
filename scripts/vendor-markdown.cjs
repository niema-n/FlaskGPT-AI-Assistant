// Keep the browser bundle and license in sync with the pinned npm dependency.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'static/dist/vendor/marked');
fs.mkdirSync(destination, { recursive: true });
for (const [source, target] of [['lib/marked.umd.js', 'marked.umd.js'], ['LICENSE', 'LICENSE']]) {
    fs.copyFileSync(path.join(root, 'node_modules/marked', source), path.join(destination, target));
}
