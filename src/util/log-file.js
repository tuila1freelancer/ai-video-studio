// A size-rotated file sink for the logger. A crash inside the .app used to leave nothing behind:
// the shell captured stdout and the window closed with it.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

let file = null;
let size = 0;

/** Start writing to `<dir>/app.log`; a directory that cannot be created disables the sink. */
export function openLogFile(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    file = join(dir, 'app.log');
    size = existsSync(file) ? statSync(file).size : 0;
  } catch { file = null; }
  return file;
}

function rotate() {
  for (let i = KEEP - 1; i >= 1; i -= 1) {
    const from = `${file}.${i}`;
    const to = `${file}.${i + 1}`;
    if (existsSync(from)) { if (i + 1 > KEEP) unlinkSync(from); else renameSync(from, to); }
  }
  renameSync(file, `${file}.1`);
  size = 0;
}

/** Append one line; failures are swallowed — a full disk must not take the render down. */
export function writeLogLine(line) {
  if (!file) return;
  try {
    if (size > MAX_BYTES) rotate();
    const buf = `${new Date().toISOString()} ${line}\n`;
    appendFileSync(file, buf);
    size += Buffer.byteLength(buf);
  } catch { /* best effort */ }
}
