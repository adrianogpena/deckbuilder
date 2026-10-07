import type { Messages } from '@deckbase/ui';
import type { en } from './en';

export const ptBR: Messages<typeof en> = {
  'nav.section.main': 'Principal',
  'nav.home': 'Início',
  'nav.settings': 'Configurações',
  'nav.theme.dark': 'Tema escuro',
  'nav.theme.light': 'Tema claro',

  'home.crumb': 'Visão geral',
  'home.title': 'Início',
  'home.system': 'Sistema',
  'home.version': 'Versão',
  'home.platform': 'Plataforma',
  'home.host': 'Máquina',
  'home.runtime': 'Runtime',
  'home.mode': 'Modo',
  'home.mode.desktop': 'Janela desktop',
  'home.mode.browser': 'Navegador',
  'home.started': 'Iniciado',
  'home.dataDir': 'Pasta de dados',
  'home.echo': 'Requisição de exemplo',
  'home.echoHint': 'Envia o texto para POST /api/echo e mostra a resposta.',
  'home.echoPlaceholder': 'Digite algo…',
  'home.send': 'Enviar',
  'home.echoResult': '{length} caracteres, respondido às {at}',

  'settings.crumb': 'Preferências',
  'settings.title': 'Configurações',
  'settings.theme': 'Tema',
  'settings.theme.dark': 'Escuro',
  'settings.theme.light': 'Claro',
  'settings.language': 'Idioma',
  'settings.saved': 'Salvo',

  'error.emptyText': 'Digite algo primeiro.',
};
