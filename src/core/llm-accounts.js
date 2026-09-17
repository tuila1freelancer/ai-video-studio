// LLM account bookkeeping shared by the settings router and the tests.

/**
 * Keep `llm.accounts[preset]` in step with the provider currently in use, so switching to
 * another provider and back does not cost a trip to a dashboard for a fresh key.
 *
 * It happens HERE, after applyMaskedUpdate, because this is the only place a real key exists:
 * the panel only ever holds the masked 'ab12••' form. Two things have to be got right, and
 * both were bugs before they were code.
 *
 * 1. '••' means "keep the saved key" — but the SAVED one is whichever provider was active
 *    before this update, so resolving a masked key that way hands the newly chosen provider
 *    the previous one's key. It has to resolve against the account it was displayed from.
 * 2. The provider being left behind keeps its key only at the top level, which this update is
 *    about to overwrite. Snapshot it first or it is gone for good.
 */
export function syncLlmAccounts(prev, next, incoming) {
  const llm = next?.llm;
  if (!llm?.preset) return;
  const accounts = { ...(llm.accounts || {}) };

  // (1) the masked key on screen came from this provider's account, not from the top level
  const shown = prev?.llm?.accounts?.[llm.preset]?.apiKey;
  if (shown && typeof incoming?.apiKey === 'string' && incoming.apiKey.includes('••')) llm.apiKey = shown;
  const record = (id, from) => {
    const entry = { apiKey: from.apiKey || '', model: from.model || '', codegenModel: from.codegenModel || '' };
    // Only a custom endpoint owns its URL; every other one gets it from the catalogue, and
    // storing it back would make the entry permanently non-empty — so clearing a key could
    // then never actually forget the provider.
    if (id === 'custom') entry.baseUrl = from.baseUrl || '';
    if (entry.apiKey || entry.model || entry.baseUrl || entry.codegenModel) accounts[id] = entry;
    else delete accounts[id];
  };
  // (2) the provider being left behind, before the top level is overwritten. Skipped when the
  // panel already sent a real key for it, which means the owner edited it deliberately.
  const was = prev?.llm || {};
  if (was.preset && was.preset !== llm.preset && was.apiKey && !accounts[was.preset]?.apiKey) record(was.preset, was);
  record(llm.preset, llm);
  next.llm = { ...llm, accounts };
}
