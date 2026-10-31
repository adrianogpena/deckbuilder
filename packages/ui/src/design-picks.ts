import type { DesignVariant } from './design';

/** Layout id of the combination picked from the design explore (docs/design-explore.md). */
export const COCKPIT_LAYOUT = 'cockpit';

/** Cockpit: command bar + activity strip shell (A), Workbench A, REST B, every other view as today. */
export const COCKPIT_PICKS: Readonly<Record<string, DesignVariant>> = {
  shell: 'a',
  dashboard: 'current',
  explorer: 'current',
  git: 'current',
  workbench: 'a',
  rest: 'b',
  terminal: 'current',
};

/** Variants already built and looked at per view, picked or not. A new explore run suggests something else for these views. */
export const TESTED_DESIGNS: Readonly<Record<string, readonly DesignVariant[]>> = {
  shell: ['a', 'b', 'c'],
  dashboard: ['a', 'b', 'c'],
  explorer: ['a', 'b', 'c'],
  git: ['a', 'b', 'c'],
  workbench: ['a', 'b', 'c'],
  rest: ['a', 'b', 'c'],
  terminal: ['a', 'b', 'c'],
};

/** The variant a layout picks for a view; `current` when the layout has no picks. */
export function layoutPick(layoutId: string | undefined, view: string): DesignVariant {
  return layoutId === COCKPIT_LAYOUT ? COCKPIT_PICKS[view] ?? 'current' : 'current';
}
