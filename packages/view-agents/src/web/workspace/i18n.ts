import type { Messages } from '@kedalion/ui';

export const en = {
  'workspace.comingSoon': 'Coming soon',
  'workspace.comingSoon.desc': 'This tool is not built yet.',
  'workspace.missing': 'Missing panel',
  'workspace.missing.desc': 'This layout has a panel ("{kind}") that this version does not have.',
  'workspace.crashed': 'Panel crashed',
  'workspace.reload': 'Reload',
  'workspace.empty.title': 'No session selected',
  'workspace.empty.desc': 'Select a session in the list or start a new Claude session.',
  'workspace.empty.newSession': 'New session',
  'workspace.noProject': 'This folder is not an added project.',
  'workspace.agent.missing': 'Session not found',
  'workspace.agent.missing.desc': 'This session is not in the list (deleted, or another account owns it).',
};

export const ptBR: Messages<typeof en> = {
  'workspace.comingSoon': 'Em breve',
  'workspace.comingSoon.desc': 'Esta ferramenta ainda não foi criada.',
  'workspace.missing': 'Painel ausente',
  'workspace.missing.desc': 'Este layout tem um painel ("{kind}") que esta versão não tem.',
  'workspace.crashed': 'O painel travou',
  'workspace.reload': 'Recarregar',
  'workspace.empty.title': 'Nenhuma sessão selecionada',
  'workspace.empty.desc': 'Selecione uma sessão na lista ou inicie uma nova sessão do Claude.',
  'workspace.empty.newSession': 'Nova sessão',
  'workspace.noProject': 'Esta pasta não é um projeto adicionado.',
  'workspace.agent.missing': 'Sessão não encontrada',
  'workspace.agent.missing.desc': 'Esta sessão não está na lista (apagada, ou de outra conta).',
};
