import { IconButton, useDialogs } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { requestRefresh } from '../../panel';
import { runAction } from '../../source';
import type { Ticket } from './model';
import { showTicketsNow, type TicketsConfig } from './TicketsPanel';

export function TicketsActions({ config }: { config: TicketsConfig }) {
  const dialogs = useDialogs();

  const add = async () => {
    const value = await dialogs.prompt({ title: tKey('dash.tickets.add'), label: tKey('dash.tickets.add.placeholder') });
    const key = value?.trim();
    if (!key) return;
    try {
      showTicketsNow(await runAction<Ticket[]>('tickets', 'add', config, { key }));
    } catch (err) {
      await dialogs.confirm({ title: tKey('dash.tickets.add'), body: String((err as Error)?.message ?? err), okLabel: 'OK' });
    } finally {
      requestRefresh('tickets');
    }
  };

  return (
    <>
      <IconButton icon="plus" label={tKey('dash.tickets.add')} onClick={() => void add()} />
      {dialogs.element}
    </>
  );
}
