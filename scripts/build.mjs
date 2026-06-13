// Bundles src/index.js into single-file outputs so the project can be deployed
// by simply uploading one file:
//   - _worker.js        -> Cloudflare Pages (advanced mode) / dashboard upload
//   - dist/worker.js    -> Cloudflare Workers dashboard upload
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  // cloudflare:sockets is provided by the runtime; keep it external.
  external: ['cloudflare:sockets'],
  legalComments: 'none',
};

await build({ ...common, outfile: '_worker.js' });
await build({ ...common, outfile: 'dist/worker.js' });

console.log('Built _worker.js and dist/worker.js');
