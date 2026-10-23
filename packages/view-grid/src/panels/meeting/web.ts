import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { MeetingPanel, type MeetingConfig } from './MeetingPanel';
import type { Meeting } from './model';

const meetingPanel = definePanel<MeetingConfig, Meeting>({
  kind: 'meeting',
  title: 'dash.meeting.panel',
  description: 'dash.meeting.panel.description',
  icon: 'check',
  category: 'dash.category.meeting',
  size: { w: 6, h: 10, minW: 3, minH: 4 },
  load: (config) => fetchSource<Meeting>('meeting', config),
  refreshMs: 60_000,
  allowMultiple: false,
  render: ({ config, data, refresh }) => createElement(MeetingPanel, { config, data, refresh }),
});

export const panels: AnyPanelKind[] = [meetingPanel];
