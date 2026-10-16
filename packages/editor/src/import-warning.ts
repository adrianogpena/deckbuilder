import { tryT } from '@deckbuilderkit/ui';

/** `<code>:<argument>` from the parser → translated text; unknown codes show as they are. */
export const warningText = (warning: string) => {
  const colon = warning.indexOf(':');
  const code = colon < 0 ? warning : warning.slice(0, colon);
  return tryT(`rest.import.warn.${code}`, { arg: colon < 0 ? '' : warning.slice(colon + 1) }) ?? warning;
};
