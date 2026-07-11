// Test isolation: point the app at a throwaway data dir BEFORE any module opens the DB.
// Import this FIRST in every test file that touches src/db or src/config/paths.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.AVS_DATA_DIR) {
  process.env.AVS_DATA_DIR = mkdtempSync(join(tmpdir(), 'avs-test-'));
}
