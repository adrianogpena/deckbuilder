import type { PanelField } from '@kedalion/ui/grid';

export const TODO_FIELDS: readonly PanelField[] = [
  { key: 'connection', kind: 'connection', connectionType: 'todoist', default: '', label: 'dash.daily.todo.connection', description: 'dash.daily.todo.connection.hint' },
  { key: 'filter', kind: 'string', default: '', label: 'dash.daily.todo.filter', description: 'dash.daily.todo.filter.hint', placeholder: 'today | overdue', maxLength: 200 },
];
