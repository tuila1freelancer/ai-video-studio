#!/usr/bin/env node
// Write the OpenAPI document to disk, for the Agent Kit and for anyone who wants it without a
// running server.
//
//   node scripts/gen-openapi.mjs [--out docs/agent/openapi.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../src/api/spec/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--out');
const out = resolve(ROOT, i > 0 && process.argv[i + 1] ? process.argv[i + 1] : join('docs', 'agent', 'openapi.json'));
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const doc = buildOpenApi({ version });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
process.stdout.write(`openapi: ${out} — ${Object.keys(doc.paths).length} paths, v${version}\n`);
