import { IconButton, useDialogs } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { requestRefresh } from '../../panel';
import { runAction } from '../../source';
import type { MeetingConfig } from './MeetingPanel';

export function MeetingActions({ config }: { config: MeetingConfig }) {
  const dialogs = useDialogs();

  const act = async (name: string, payload?: unknown) => {
    try {
      await runAction('meeting', name, config, payload);
    } finally {
      requestRefresh('meeting');
    }
  };

  const add = async () => {
    const value = await dialogs.prompt({ title: tKey('dash.meeting.add'), label: tKey('dash.meeting.add.placeholder') });
    const name = value?.trim();
    if (name) void act('add', { name });
  };

  return (
    <>
      <IconButton icon="plus" label={tKey('dash.meeting.add')} onClick={() => void add()} />
      <IconButton icon="refresh" label={tKey('dash.meeting.reset')} onClick={() => void act('reset')} />
      {dialogs.element}
    </>
  );
}
