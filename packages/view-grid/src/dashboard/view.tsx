import { defineView } from '@deckbuilderkit/ui';
import { en as gridEn, ptBR as gridPtBR } from '../i18n';
import type { AnyPanelKind } from '../panel';
import { en as calendarEn, ptBR as calendarPtBR } from '../panels/calendar/i18n';
import { en as feedsEn, ptBR as feedsPtBR } from '../panels/feeds/i18n';
import { en as githubEn, ptBR as githubPtBR } from '../panels/github/i18n';
import { en as jiraEn, ptBR as jiraPtBR } from '../panels/jira/i18n';
import { en as miscEn, ptBR as miscPtBR } from '../panels/misc/i18n';
import { DashboardScreen, type DashboardViewSettings } from './DashboardScreen';
import { en, ptBR } from './i18n';

export interface DashboardViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The panel kinds the user can add (`dashboardPanels`). */
  panels: readonly AnyPanelKind[];
}

export function dashboardView({ group, order, panels }: DashboardViewOptions) {
  return defineView<'dashboard', DashboardViewSettings, 'nav.dashboard'>({
    id: 'dashboard',
    nav: { group, icon: 'cube', label: 'nav.dashboard', order },
    render: ({ settings, onSave }) => <DashboardScreen settings={settings} onSave={onSave} panels={panels} />,
    messages: {
      en: { ...gridEn, ...en, ...githubEn, ...jiraEn, ...calendarEn, ...feedsEn, ...miscEn },
      'pt-BR': { ...gridPtBR, ...ptBR, ...githubPtBR, ...jiraPtBR, ...calendarPtBR, ...feedsPtBR, ...miscPtBR },
    },
  });
}
