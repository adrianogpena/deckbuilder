import type { PanelConfig } from '@kedalion/ui/grid';
import { SourceError, sourceFetch } from '../../connections/errors';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { SPELLCHECK_FIELDS } from './fields';
import { AUTO, checkUrl, isLanguageCode, MAX_TEXT, parseCheck, type SpellResult } from './model';

export const specs: GridPanelSpec[] = [{ kind: 'spellcheck', fields: SPELLCHECK_FIELDS, allowMultiple: false }];

const spellcheck = defineSource<PanelConfig>({
  id: 'spellcheck',
  fields: SPELLCHECK_FIELDS,
  fetch: () => null,
  actions: {
    async check(payload, config, ctx): Promise<SpellResult> {
      const { text: raw, language: lang } = (payload ?? {}) as { text?: unknown; language?: unknown };
      const text = typeof raw === 'string' ? raw.slice(0, MAX_TEXT) : '';
      const language = typeof lang === 'string' && isLanguageCode(lang) ? lang : AUTO;
      if (!text.trim()) return { language, issues: [] };
      const url = checkUrl(String(config.server ?? ''));
      if (!url) throw SourceError('not-configured', 'The LanguageTool server URL must be http(s).');
      const body = new URLSearchParams({ text, language, level: 'picky' });
      if (language === AUTO) body.set('preferredVariants', 'en-US,pt-BR');
      const res = await sourceFetch(url, { method: 'POST', body, headers: { Accept: 'application/json' } }, ctx);
      const result = parseCheck(await res.json().catch(() => undefined), text);
      if (!result) throw SourceError('upstream', 'The server answered in an unexpected format.');
      return result;
    },
  },
});

/** Server data sources of the spellcheck panel (no React). */
export const sources: DataSource<any>[] = [spellcheck];
