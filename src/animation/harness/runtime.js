// The complete in-page runtime — three fragments joined into the one script the page carries.
// Split by concern only; the concatenation is byte-identical to the single string it replaced.
import { HANDOFF, RUNTIME_CORE } from './runtime-core.js';
import { RUNTIME_TYPESET } from './runtime-typeset.js';
import { RUNTIME_SEEK } from './runtime-seek.js';

export { HANDOFF };
export const RUNTIME = RUNTIME_CORE + RUNTIME_TYPESET + RUNTIME_SEEK;
