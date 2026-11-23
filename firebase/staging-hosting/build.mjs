// Prepare ONLY public files for the separate, no-cost Firebase test project.
// This script does not publish anything or modify production Firestore.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workDir = fileURLToPath(new URL('./', import.meta.url));
const repoDir = path.resolve(workDir, '../..');
const destination = path.join(workDir, 'public');
const assets = path.join(workDir, 'assets');

const localFiles = [
  'scan.html', 'live.html', 'email-action.html', 'jk-accounts.js', 'jk-admin.js',
  'privacy.html', 'pamyat.html', 'luna.html', 'psalter.json',
  'manifest.webmanifest', 'coi-sw.js'
];
// Public client-side code and AI weights served by the existing JadeKey website.
// Pin hashes so a changed upstream response cannot silently be deployed.
const modelFiles = {
  'vendor/transformers.min.js': '79fad8c1c2fd165bf1e77ace20ce023fab4dc13b6621f0e586c9b8c59c4d09d8',
  'vendor/ort-wasm-simd-threaded.jsep.js': '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9',
  'vendor/ort-wasm-simd-threaded.jsep.wasm': 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39',
  'models/dinov2/model.onnx': 'f22797eabf810a75e41de68d378541ebea372122b25c4ce3ef25ff618250c20a'
};

for (const page of ['scan.html', 'live.html']) {
  const source = readFileSync(path.join(repoDir, page), 'utf8');
  if (!source.includes("['jadekey-test.web.app', 'jadekey-test.firebaseapp.com'].includes(location.hostname)") ||
      !source.includes("{ project: 'jadekey-test', key: 'AIzaSyC8Ks3L5ClsRVUTdGS2aBKf4h7296T3QN8' }")) {
    throw new Error(`${page} is not safely configured for jadekey-test. Refusing to build.`);
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

for (const [file, expectedHash] of Object.entries(modelFiles)) {
  const cached = path.join(assets, file);
  if (!existsSync(cached)) {
    mkdirSync(path.dirname(cached), { recursive: true });
    const publicUrl = `https://jadekey.tech/${file}`;
    console.log(`Downloading public scanner asset: ${file}`);
    execFileSync('curl', [
      '-fsSL', '--retry', '2', '--connect-timeout', '15', '--max-time', '180',
      '-A', 'Mozilla/5.0', '-o', cached, publicUrl
    ], { stdio: 'inherit' });
  }
  if (sha256(cached) !== expectedHash) {
    throw new Error(`Asset ${file} hash differs from vetted public release. Refusing to build.`);
  }
}

const expectedFiles = new Set([
  'index.html', 'robots.txt', ...localFiles, ...Object.keys(modelFiles)
]);
function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), name) : [name];
  });
}
for (const file of listFiles(destination)) {
  if (!expectedFiles.has(file)) throw new Error(`Unexpected file in public bundle: ${file}. Refusing to build.`);
}

mkdirSync(destination, { recursive: true });
for (const file of localFiles) {
  if (file === 'scan.html' || file === 'live.html') {
    // Label only the generated test copy. Do not change the production pages.
    const source = readFileSync(path.join(repoDir, file), 'utf8');
    if (!source.includes('<body>')) throw new Error(`${file} has an unexpected HTML structure.`);
    const badge = '<div role="note" style="position:fixed;bottom:calc(env(safe-area-inset-bottom) + 12px);left:12px;z-index:2147483647;padding:6px 10px;border-radius:9px;background:#f8da80;color:#252014;font:600 12px sans-serif;pointer-events:none">JadeKey · ТЕСТ · без реальных камней</div>';
    writeFileSync(path.join(destination, file), source.replace('<body>', `<body>\n${badge}`));
  } else {
    copyFileSync(path.join(repoDir, file), path.join(destination, file));
  }
}
for (const file of Object.keys(modelFiles)) {
  mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
  copyFileSync(path.join(assets, file), path.join(destination, file));
}
copyFileSync(path.join(workDir, 'index.html'), path.join(destination, 'index.html'));
writeFileSync(path.join(destination, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`Staging bundle ready: ${destination} (${expectedFiles.size} allowlisted files).`);
console.log('Not deployed. Firestore Security Rules remain unchanged.');
