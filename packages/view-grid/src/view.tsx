import { defineView } from '@deckbuilderkit/ui';
import type { GridItem } from '@deckbuilderkit/ui';
import { GridScreen, type GridViewSettings } from './GridScreen';
import { en, ptBR } from './i18n';
import type { AnyPanelKind } from './panel';

export interface GridViewOptions {
  /** i18n key of the nav section title. */
  group: string;
  order: number;
  /** The panel kinds the user can add; build them with `definePanel` or take the built-in ones (`clockPanel`). */
  panels: readonly AnyPanelKind[];
  /** The layout of a fresh install and of Restore default; empty when omitted. */
  defaultLayout?: readonly GridItem[];
}

export function gridView({ group, order, panels, defaultLayout = [] }: GridViewOptions) {
  return defineView<'grid', GridViewSettings, 'nav.grid'>({
    id: 'grid',
    nav: { group, icon: 'cube', label: 'nav.grid', order },
    render: ({ settings, onSave }) => <GridScreen settings={settings} onSave={onSave} panels={panels} defaultLayout={defaultLayout} />,
    messages: { en, 'pt-BR': ptBR },
  });
}
