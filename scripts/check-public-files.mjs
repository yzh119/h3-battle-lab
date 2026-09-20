import { execFileSync } from 'node:child_process';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = tracked.filter(path => /(?:^|\/)(?:local-assets|\.local|dist|node_modules)\//.test(path)
  || /\.(?:glb|gltf|blend\d*|fbx|obj|bin|png|jpe?g|webp|gif|mp4|hdr|exr)$/i.test(path));
if (forbidden.length) { console.error('Private/generated assets must not be tracked:', forbidden); process.exit(1); }
console.log(`Source-only check passed: ${tracked.length} tracked files.`);
