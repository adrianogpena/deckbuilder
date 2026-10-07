export type Params = Record<string, string | number>;

/** Messages the base components and the API client use; apps add their own with `addMessages`. */
const baseEn = {
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.details': 'Details',
  'common.hideDetails': 'Hide details',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.close': 'Close',

  'error.offline': 'The app server is not responding.',
  'error.invalidToken': 'Invalid session. Open the address printed in the terminal.',
  'error.routeNotFound': 'Route not found.',
  'error.invalidJson': 'Invalid JSON.',
  'error.bodyTooLarge': 'Request body too large.',
  'error.http': 'HTTP error {status}',
  'error.updateFromSource': 'Running from source: only the built exe can update itself.',
  'error.updateNotConfigured': 'No update source is configured.',
  'error.updateBusy': 'An update is already running.',
  'error.updateUnreachable': 'The release folder could not be read.',
  'error.updateUpToDate': 'Already up to date (v{version}).',
  'error.updateNoBuild': 'Release {version} has no build for {label}.',
  'error.updateChecksum': 'The copied file does not match the release checksum.',
  'error.updateFailed': 'Update failed: {message}',
};

export type BaseKey = keyof typeof baseEn;
/** A dictionary with the same keys as `T`: TypeScript fails until a translation has every key. */
export type Messages<T> = Record<keyof T, string>;

const basePtBR: Messages<typeof baseEn> = {
  'common.loading': 'Carregando…',
  'common.retry': 'Tentar de novo',
  'common.details': 'Detalhes',
  'common.hideDetails': 'Ocultar detalhes',
  'common.copy': 'Copiar',
  'common.copied': 'Copiado',
  'common.close': 'Fechar',

  'error.offline': 'O servidor do app não está respondendo.',
  'error.invalidToken': 'Sessão inválida. Abra o endereço mostrado no terminal.',
  'error.routeNotFound': 'Rota não encontrada.',
  'error.invalidJson': 'JSON inválido.',
  'error.bodyTooLarge': 'Corpo da requisição grande demais.',
  'error.http': 'Erro HTTP {status}',
  'error.updateFromSource': 'Rodando do código-fonte: só o exe compilado se atualiza.',
  'error.updateNotConfigured': 'Nenhuma fonte de atualização configurada.',
  'error.updateBusy': 'Uma atualização já está em andamento.',
  'error.updateUnreachable': 'Não foi possível ler a pasta de releases.',
  'error.updateUpToDate': 'Já está atualizado (v{version}).',
  'error.updateNoBuild': 'O release {version} não tem build para {label}.',
  'error.updateChecksum': 'O arquivo copiado não confere com o checksum do release.',
  'error.updateFailed': 'Falha na atualização: {message}',
};

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'pt-BR', label: 'Português' },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];

const dictionaries: Record<Language, Record<string, string>> = { en: { ...baseEn }, 'pt-BR': { ...basePtBR } };

/** Adds an app's messages; call once at startup, before the first render. */
export function addMessages(dicts: Record<Language, Record<string, string>>): void {
  for (const lang of Object.keys(dicts) as Language[]) Object.assign(dictionaries[lang], dicts[lang]);
}

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.id === value);
}

export function detectLanguage(): Language {
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

// Module-level so non-React helpers can translate too.
// The app re-renders from the top when the language changes.
let current: Language = detectLanguage();

export function setLanguage(lang: Language) {
  current = lang;
  document.documentElement.lang = lang;
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

/** For keys built at runtime (error codes); undefined when unknown. */
export function tryT(key: string, params?: Params): string | undefined {
  const text = dictionaries[current][key] ?? dictionaries.en[key];
  return text === undefined ? undefined : interpolate(text, params);
}

/** `t` typed to the base keys plus an app's keys `K`: `export const t = createT<keyof typeof en>()`. */
export function createT<K extends string>(): (key: K | BaseKey, params?: Params) => string {
  return (key, params) => tryT(key, params) ?? key;
}

export const t = createT<never>();
