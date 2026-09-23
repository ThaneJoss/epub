import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { patchSinglePageLayout } from './patch-bibi.mjs';

const release = 'https://github.com/satorumurmur/bibi/releases/download/v1.2.0/Bibi-v1.2.0.zip';
const sha256 = '09c539c512a1171570c4bf30dc5f151e594b120f99d4b1be0107b289de97a9cd';
const cache = '.cache/Bibi-v1.2.0.zip';
let archive;
try { archive = await readFile(cache); } catch {
  console.log('Downloading Bibi v1.2.0…');
  const response = await fetch(release, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Bibi download failed: HTTP ${response.status}`);
  archive = new Uint8Array(await response.arrayBuffer());
}
if (createHash('sha256').update(archive).digest('hex') !== sha256) throw new Error('Bibi checksum mismatch');
await mkdir('.cache', { recursive: true });
await writeFile(cache, archive);
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const [path, bytes] of Object.entries(unzipSync(archive))) {
  if (!path.startsWith('bibi/') || path.endsWith('/') || path.split('/').includes('..')) continue;
  const output = resolve('dist', path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}
await cp('public', 'dist', { recursive: true });
await cp('reader', 'dist/bibi', { recursive: true });
const bibiScript = 'dist/bibi/resources/scripts/bibi.js';
await writeFile(bibiScript, patchSinglePageLayout(await readFile(bibiScript, 'utf8')));
// Replace Bibi's historical bundled sanitizer with a pinned current DOMPurify.
const purify = await readFile('node_modules/dompurify/dist/purify.min.js', 'utf8');
const extension = await readFile('reader/sanitizer-extension.js', 'utf8');
await writeFile('dist/bibi/extensions/sanitizer.js', `${purify}\n${extension}`);
await rm('dist/bibi/sanitizer-extension.js');
const entries = unzipSync(archive);
await mkdir('dist/licenses', { recursive: true });
await writeFile('dist/licenses/Bibi.txt', entries.LICENSE);
await cp('node_modules/dompurify/LICENSE', 'dist/licenses/DOMPurify.txt');
console.log('Built dist/: homepage + Bibi + hardened sanitizer.');
