import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { FocusTimerPanel, ScratchpadPanel, SnippetsPanel, TodoPanel } from './Panels';
import type { Daily } from './model';

const CATEGORY = 'dash.category.daily';

const stored = (kind: string, title: string, icon: 'check' | 'edit' | 'copy', size: { w: number; h: number; minW: number; minH: number }, view: typeof TodoPanel) =>
  definePanel<Record<string, unknown>, Daily>({
    kind,
    title,
    description: `${title}.description`,
    icon,
    category: CATEGORY,
    size,
    allowMultiple: false,
    load: (config) => fetchSource<Daily>(kind, config),
    render: ({ config, data, refresh }) => createElement(view, { config, data, refresh }),
  });

const timerPanel = definePanel({
  kind: 'focus-timer',
  title: 'dash.daily.timer',
  description: 'dash.daily.timer.description',
  icon: 'play',
  category: CATEGORY,
  size: { w: 6, h: 8, minW: 3, minH: 5 },
  allowMultiple: false,
  render: () => createElement(FocusTimerPanel),
});

export const panels: AnyPanelKind[] = [
  stored('todo', 'dash.daily.todo', 'check', { w: 6, h: 12, minW: 3, minH: 5 }, TodoPanel),
  stored('scratchpad', 'dash.daily.scratch', 'edit', { w: 8, h: 10, minW: 3, minH: 4 }, ScratchpadPanel),
  stored('snippets', 'dash.daily.snippets', 'copy', { w: 6, h: 10, minW: 3, minH: 5 }, SnippetsPanel),
  timerPanel,
];
