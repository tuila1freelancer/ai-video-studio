// Where the codegen doctrine lives, and who talks to the model.
//
// Today: both are here on the customer's machine. The 181 KB of prompt in prompt.js is the product,
// and a release ships it as encrypted bytecode — which stops someone reading it out of the bundle,
// and does nothing at all about the fact that the customer supplies the LLM endpoint and can read
// every prompt verbatim in their own provider's dashboard.
//
// Closing that needs the doctrine to run somewhere the customer does not control: the app sends the
// scene brief, the store builds the prompt and calls the model with the VENDOR's key, and only the
// spec comes back. This module exists so that change is a second implementation of one small
// interface rather than surgery on the re-ask loop. See docs/prompt-doctrine-service.md.
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
