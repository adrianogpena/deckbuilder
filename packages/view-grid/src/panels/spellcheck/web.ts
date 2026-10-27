import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { SPELLCHECK_FIELDS } from './fields';
import { SpellcheckPanel } from './SpellcheckPanel';

const spellcheckPanel = definePanel({
  kind: 'spellcheck',
  title: 'dash.spell.panel',
  description: 'dash.spell.panel.description',
  icon: 'edit',
  category: 'dash.category.daily',
  size: { w: 8, h: 16, minW: 4, minH: 8 },
  config: { fields: SPELLCHECK_FIELDS },
  allowMultiple: false,
  render: ({ config }) => createElement(SpellcheckPanel, { config }),
});

/** The spellcheck panel kind. */
export const panels: AnyPanelKind[] = [spellcheckPanel];
