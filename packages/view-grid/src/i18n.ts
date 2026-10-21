import { createT, type Messages } from '@deckbuilderkit/ui';

export const en = {
  'nav.grid': 'Grid',
  'grid.add': 'Add panel',
  'grid.save': 'Save',
  'grid.reset': 'Reset',
  'grid.restoreDefault': 'Restore default',
  'grid.loadFailed': 'Could not load',
  'grid.refreshFailed': 'Could not refresh',
  'grid.cancel': 'Cancel',
  'grid.back': 'Back',
  'grid.apply': 'Apply',
  'grid.create': 'Add',
  'grid.configure.title': 'Configure {name}',
  'grid.creator.title': 'Add a panel',
  'grid.creator.pick': 'Choose the kind of panel to add.',
  'grid.creator.empty': 'Every available panel is already on the grid.',
  'grid.creator.configure': 'Set up {name}',
  'grid.category.other': 'Other',
  'grid.category.time': 'Time',
  'grid.panel.clock': 'Clock',
  'grid.panel.clock.description': 'Current time and date, in any time zone.',
  'grid.clock.timeZone': 'Time zone',
  'grid.clock.timeZone.hint': 'An IANA name such as Europe/Lisbon; empty uses this computer’s.',
  'grid.clock.timeZone.placeholder': 'Local time zone',
  'grid.clock.hour12': '12-hour clock',
  'grid.clock.hour12.hint': 'Show AM/PM instead of 24 hours.',
  'grid.clock.showSeconds': 'Show seconds',
  'grid.clock.showDate': 'Show the date',
  'grid.clock.invalidZone': 'Unknown time zone',
};

export const ptBR: Messages<typeof en> = {
  'nav.grid': 'Grade',
  'grid.add': 'Adicionar painel',
  'grid.save': 'Salvar',
  'grid.reset': 'Desfazer',
  'grid.restoreDefault': 'Restaurar padrão',
  'grid.loadFailed': 'Não foi possível carregar',
  'grid.refreshFailed': 'Não foi possível atualizar',
  'grid.cancel': 'Cancelar',
  'grid.back': 'Voltar',
  'grid.apply': 'Aplicar',
  'grid.create': 'Adicionar',
  'grid.configure.title': 'Configurar {name}',
  'grid.creator.title': 'Adicionar um painel',
  'grid.creator.pick': 'Escolha o tipo de painel a adicionar.',
  'grid.creator.empty': 'Todos os painéis disponíveis já estão na grade.',
  'grid.creator.configure': 'Configurar {name}',
  'grid.category.other': 'Outros',
  'grid.category.time': 'Tempo',
  'grid.panel.clock': 'Relógio',
  'grid.panel.clock.description': 'Hora e data atuais, em qualquer fuso horário.',
  'grid.clock.timeZone': 'Fuso horário',
  'grid.clock.timeZone.hint': 'Um nome IANA como Europe/Lisbon; vazio usa o deste computador.',
  'grid.clock.timeZone.placeholder': 'Fuso horário local',
  'grid.clock.hour12': 'Relógio de 12 horas',
  'grid.clock.hour12.hint': 'Mostra AM/PM em vez de 24 horas.',
  'grid.clock.showSeconds': 'Mostrar segundos',
  'grid.clock.showDate': 'Mostrar a data',
  'grid.clock.invalidZone': 'Fuso horário desconhecido',
};

export type GridMessageKey = keyof typeof en;

const tGrid = createT<GridMessageKey>();

/** Translates a key a panel kind or field names (they are plain strings, the app's own keys included). */
export const tKey = (key: string, params?: Record<string, string | number>): string => tGrid(key as GridMessageKey, params);
