import type { GridItem } from '@kedalion/ui';

/** The items of every dashboard layout, so a panel can use another panel's config even when that one is on another layout. */
let all: readonly GridItem[] = [];

export const setDashboardItems = (items: readonly GridItem[]): void => {
  all = items;
};

/** The first item of `kind` on any layout (`kind` falls back to the id, as for older saved items). */
export const dashboardItemOf = (kind: string): GridItem | undefined => all.find((i) => (i.kind ?? i.id) === kind);
