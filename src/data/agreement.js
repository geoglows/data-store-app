import AGREEMENT_TEXT from "../../docs/data-usage-agreement.md?raw";

/**
 * The data usage agreement. docs/data-usage-agreement.md is the definitive text, and the Download
 * page shows it.
 */
export {AGREEMENT_TEXT};

/** The agreement as its paragraphs. */
export const AGREEMENT_PARAGRAPHS = AGREEMENT_TEXT.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
