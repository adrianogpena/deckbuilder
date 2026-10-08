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

  'palette.placeholder': 'Type a command…',
  'palette.empty': 'No matches',
  'palette.navigate': 'navigate',
  'palette.open': 'run',
  'palette.close': 'close',

  'tabs.new': 'New tab',
  'tabs.close': 'Close tab',
  'tabs.split': 'Split to the right',
  'tabs.closePane': 'Close pane',
  'tabs.back': 'Back',
  'tabs.forward': 'Forward',
  'panel.collapse': 'Collapse',
  'panel.expand': 'Expand',
  'panel.remove': 'Remove panel',

  'output.filter': 'Filter output',
  'output.copyAll': 'Copy all',
  'output.clear': 'Clear',
  'output.jumpToLatest': 'Jump to latest',

  'resource.add': 'Add',
  'resource.edit': 'Edit',
  'resource.delete': 'Delete',
  'resource.confirm': 'Confirm?',
  'resource.save': 'Save',
  'resource.cancel': 'Cancel',
  'resource.browse': 'Browse…',
  'resource.saved': 'Saved',
  'resource.clear': 'Clear',
  'resource.required': '{field} is required.',

  'theme.system': 'System',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.palette': 'Color palette',

  'error.offline': 'The app server is not responding.',
  'error.invalidToken': 'Invalid session. Open the address printed in the terminal.',
  'error.invalidCode': 'This link was already used or has expired. Open the app again.',
  'error.routeNotFound': 'Route not found.',
  'error.invalidJson': 'Invalid JSON.',
  'error.bodyTooLarge': 'Request body too large.',
  'error.http': 'HTTP error {status}',
  'error.updateFromSource': 'Running from source: only the built exe can update itself.',
  'error.updateNotConfigured': 'No update source is configured.',
  'error.updateBusy': 'An update is already running.',
  'error.updateUnreachable': "Couldn't reach the update source.",
  'error.updateUpToDate': 'Already up to date (v{version}).',
  'error.updateNoBuild': 'Release {version} has no build for {label}.',
  'error.updateChecksum': 'The copied file does not match the release checksum.',
  'error.updateBadSignature': "The update isn't signed with this app's key.",
  'error.updateNoKey': 'This build has no update key.',
  'error.updateFailed': 'Update failed: {message}',
  'error.tooManyRecords': 'The limit of saved items was reached.',
  'error.recordNotFound': 'This item no longer exists.',
  'error.missingId': 'No item was specified.',
  'error.streamClosed': 'The stream ended before it was complete.',
  'error.badStream': 'The server sent an invalid stream.',
  'error.secretsUnavailable': 'No secure store is available on this system to save passwords.',
  'error.secretUnreadable': 'A saved password could not be read on this account. Enter it again.',
  'error.dialogBusy': 'Another dialog is already open.',
  'error.dialogFailed': "The dialog couldn't be opened.",
  'error.openRefused': 'Programs and scripts are not opened from the app.',
  'error.rootNotFound': 'This folder is no longer registered or no longer exists.',
  'error.badPath': 'Invalid path.',
  'error.badRequest': 'Invalid request.',
  'error.outsideRoot': 'This path leads outside the project folder.',
  'error.exists': 'A file or folder with this name already exists.',
  'error.fileChanged': 'The file was changed on disk since it was opened.',
  'error.crossDevice': "Can't move between drives.",
  'error.rootReadOnly': 'This folder is read-only in the app.',
  'error.trashUnavailable': 'No recycle bin is available on this system.',
  'error.trashFailed': "Couldn't move to the Recycle Bin.",
  'error.fileNotFound': 'File or folder not found.',
  'error.notADir': 'This is not a folder.',
  'error.notAFile': 'This is not a file.',
  'error.moveIntoSelf': "A folder can't be moved into itself.",
  'error.fileTooLarge': 'The file is too large to show.',
  'error.accessDenied': 'Access denied, or the file is in use.',
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

  'palette.placeholder': 'Digite um comando…',
  'palette.empty': 'Nada encontrado',
  'palette.navigate': 'navegar',
  'palette.open': 'executar',
  'palette.close': 'fechar',

  'tabs.new': 'Nova aba',
  'tabs.close': 'Fechar aba',
  'tabs.split': 'Dividir à direita',
  'tabs.closePane': 'Fechar painel',
  'tabs.back': 'Voltar',
  'tabs.forward': 'Avançar',
  'panel.collapse': 'Recolher',
  'panel.expand': 'Expandir',
  'panel.remove': 'Remover painel',

  'output.filter': 'Filtrar saída',
  'output.copyAll': 'Copiar tudo',
  'output.clear': 'Limpar',
  'output.jumpToLatest': 'Ir para o fim',

  'resource.add': 'Adicionar',
  'resource.edit': 'Editar',
  'resource.delete': 'Excluir',
  'resource.confirm': 'Confirmar?',
  'resource.save': 'Salvar',
  'resource.cancel': 'Cancelar',
  'resource.browse': 'Procurar…',
  'resource.saved': 'Salvo',
  'resource.clear': 'Limpar',
  'resource.required': '{field} é obrigatório.',

  'theme.system': 'Sistema',
  'theme.dark': 'Escuro',
  'theme.light': 'Claro',
  'theme.palette': 'Paleta de cores',

  'error.offline': 'O servidor do app não está respondendo.',
  'error.invalidToken': 'Sessão inválida. Abra o endereço mostrado no terminal.',
  'error.invalidCode': 'Este link já foi usado ou expirou. Abra o app de novo.',
  'error.routeNotFound': 'Rota não encontrada.',
  'error.invalidJson': 'JSON inválido.',
  'error.bodyTooLarge': 'Corpo da requisição grande demais.',
  'error.http': 'Erro HTTP {status}',
  'error.updateFromSource': 'Rodando do código-fonte: só o exe compilado se atualiza.',
  'error.updateNotConfigured': 'Nenhuma fonte de atualização configurada.',
  'error.updateBusy': 'Uma atualização já está em andamento.',
  'error.updateUnreachable': 'Não foi possível acessar a origem das atualizações.',
  'error.updateUpToDate': 'Já está atualizado (v{version}).',
  'error.updateNoBuild': 'O release {version} não tem build para {label}.',
  'error.updateChecksum': 'O arquivo copiado não confere com o checksum do release.',
  'error.updateBadSignature': 'A atualização não está assinada com a chave deste app.',
  'error.updateNoKey': 'Esta versão não tem chave de atualização.',
  'error.updateFailed': 'Falha na atualização: {message}',
  'error.tooManyRecords': 'O limite de itens salvos foi atingido.',
  'error.recordNotFound': 'Este item não existe mais.',
  'error.missingId': 'Nenhum item foi informado.',
  'error.streamClosed': 'O fluxo terminou antes de ser concluído.',
  'error.badStream': 'O servidor enviou um fluxo inválido.',
  'error.secretsUnavailable': 'Não há um armazenamento seguro neste sistema para salvar senhas.',
  'error.secretUnreadable': 'Uma senha salva não pôde ser lida nesta conta. Digite-a de novo.',
  'error.dialogBusy': 'Outra janela de diálogo já está aberta.',
  'error.dialogFailed': 'Não foi possível abrir a janela de diálogo.',
  'error.openRefused': 'Programas e scripts não são abertos pelo app.',
  'error.rootNotFound': 'Esta pasta não está mais registrada ou não existe mais.',
  'error.badPath': 'Caminho inválido.',
  'error.badRequest': 'Requisição inválida.',
  'error.outsideRoot': 'Este caminho leva para fora da pasta do projeto.',
  'error.exists': 'Já existe um arquivo ou pasta com este nome.',
  'error.fileChanged': 'O arquivo foi alterado no disco desde que foi aberto.',
  'error.crossDevice': 'Não é possível mover entre unidades.',
  'error.rootReadOnly': 'Esta pasta é somente leitura no app.',
  'error.trashUnavailable': 'Não há lixeira disponível neste sistema.',
  'error.trashFailed': 'Não foi possível mover para a Lixeira.',
  'error.fileNotFound': 'Arquivo ou pasta não encontrado.',
  'error.notADir': 'Isto não é uma pasta.',
  'error.notAFile': 'Isto não é um arquivo.',
  'error.moveIntoSelf': 'Uma pasta não pode ser movida para dentro dela mesma.',
  'error.fileTooLarge': 'O arquivo é grande demais para exibir.',
  'error.accessDenied': 'Acesso negado, ou o arquivo está em uso.',
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

export function setLanguage(lang: string) {
  current = isLanguage(lang) ? lang : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
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
