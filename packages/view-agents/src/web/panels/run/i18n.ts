import type { Messages } from '@deckbuilderkit/ui';

export const en = {
  'panel.run.title': 'Run',
  'panel.run.empty': 'Nothing to run here: no package.json scripts, go.mod, Cargo.toml, .csproj, manage.py, pom.xml, gradle or compose file in the project folder.',
  'panel.run.noProject': 'Select a project to run its apps.',
  'panel.run.start': 'Start',
  'panel.run.stop': 'Stop',
  'panel.run.restart': 'Restart',
  'panel.run.logs': 'Logs',
  'panel.run.hideLogs': 'Hide logs',
  'panel.run.noLogs': 'No output yet.',
  'panel.run.status.running': 'Running',
  'panel.run.status.stopped': 'Stopped',
  'panel.run.status.exited': 'Exited',
  'panel.run.exitCode': 'exit code {code}',
  'panel.run.openUrl': 'Open {url}',
};

export const ptBR: Messages<typeof en> = {
  'panel.run.title': 'Executar',
  'panel.run.empty': 'Nada para executar aqui: nenhum script do package.json, go.mod, Cargo.toml, .csproj, manage.py, pom.xml, gradle ou compose na pasta do projeto.',
  'panel.run.noProject': 'Selecione um projeto para executar seus apps.',
  'panel.run.start': 'Iniciar',
  'panel.run.stop': 'Parar',
  'panel.run.restart': 'Reiniciar',
  'panel.run.logs': 'Logs',
  'panel.run.hideLogs': 'Ocultar logs',
  'panel.run.noLogs': 'Sem saída ainda.',
  'panel.run.status.running': 'Em execução',
  'panel.run.status.stopped': 'Parado',
  'panel.run.status.exited': 'Encerrado',
  'panel.run.exitCode': 'código de saída {code}',
  'panel.run.openUrl': 'Abrir {url}',
};
