// Where the codegen doctrine lives, and who talks to the model.
//
// Today: both are here on the customer's machine. The 181 KB of prompt in prompt.js is the product,
// and a release ships it as encrypted bytecode — which stops someone reading it out of the bundle,
// and does nothing at all about the fact that the customer supplies the LLM endpoint and can read
// every prompt verbatim in their own provider's dashboard.
//
// The owner weighed that and accepted it (2026-08-19) — the requirement is that no source ships, and
// none does. This module stays anyway, because the boundary is right on its own terms: the re-ask
// loop has no business knowing what a prompt looks like or which provider answers it. If the sales
// model ever changes, docs/prompt-doctrine-service.md is the spec for a second implementation.
//
// The interface is a SESSION, not a function, because getting a scene right takes up to ten rounds
// of "here is what is wrong, fix it" — and whoever owns the prompt has to own that conversation.
import { chat } from '../providers/llm.js';
import { buildCodegenPrompt } from './prompt.js';

/** Tokens per reply. Full-page raw-GSAP specs are large; providers stop early when done. */
const MAX_TOKENS = 24000;

/** system + brief. Every re-ask truncates back to these two and appends one attempt/fix pair. */
const KEPT = 2;

/**
 * A codegen conversation for one scene.
 *
 * `ask` returns the raw reply text. `reaskFormat` and `reaskIssues` shape what the next `ask`
 * sends — history stays bounded at system + brief + the latest pair, because older failures add
 * tokens and no signal.
 */
export function localDoctrine(params, { ai } = {}) {
  const messages = buildCodegenPrompt(params);

  return {
    kind: 'local',
    // Exposed so tests can assert the conversation byte for byte; nothing else reads it.
    messages,

    ask({ temperature }) {
      return chat(messages, { maxTokens: MAX_TOKENS, temperature, llm: ai?.llm || null });
    },

    reaskFormat() {
      messages.length = KEPT;
      messages.push({ role: 'user', content: 'Your reply did not match the format. Reply with EXACTLY the three fenced blocks and nothing else:\n@@@CSS@@@\n(css)\n@@@HTML@@@\n(html)\n@@@SCRIPT@@@\n(js)\n@@@END@@@' });
    },

    reaskIssues(spec, issues) {
      messages.length = KEPT;
      messages.push({ role: 'assistant', content: `@@@CSS@@@\n${spec.css}\n@@@HTML@@@\n${spec.html}\n@@@SCRIPT@@@\n${spec.script}\n@@@END@@@`.slice(0, 5000) });
      messages.push({
        role: 'user',
        content: `Your scene has problems that must be fixed:\n- ${issues.join('\n- ')}\nReturn the corrected scene in the same @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced format — keep what worked, fix only the listed issues.`,
      });
    },
  };
}

/**
 * Open a session. One implementation today; `remote` is specified in
 * docs/prompt-doctrine-service.md and deliberately not written yet — an untested client for an
 * endpoint that does not exist would be dead code pretending to be a feature.
 */
export function openDoctrine(params, opts = {}) {
  return localDoctrine(params, opts);
}
