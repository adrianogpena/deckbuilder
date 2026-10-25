import { useState } from 'react';
import { Button, IconButton, Modal } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { formatEntries, parseEntries, type PodEntry } from './model';
import type { PodsConfig } from './PodsPanel';
import { PodEntryFields, usePodChoices } from './PodEntryFields';
import './pods.css';

const LAST_KEY = 'deckbuilder.pods.lastEntry';

function readLast(): Partial<PodEntry> {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
    return { context: typeof v.context === 'string' ? v.context : undefined, namespace: typeof v.namespace === 'string' ? v.namespace : undefined };
  } catch {
    return {};
  }
}

function writeLast(entry: PodEntry) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ context: entry.context, namespace: entry.namespace }));
  } catch {
    // storage unavailable; the next popup falls back to the current context
  }
}

function AddPodDialog({ config, setConfig, onClose }: { config: PodsConfig; setConfig: (next: PodsConfig) => void; onClose: () => void }) {
  const entries = parseEntries(config.clusters ?? '');
  const [entry, setEntry] = useState<PodEntry>(() => {
    const last = readLast();
    return { context: last.context ?? '', namespace: last.namespace ?? '', pod: '' };
  });
  const { contexts, namespaces } = usePodChoices(config, entry.context, entries.map((e) => e.namespace));
  const effective: PodEntry = entry.context || !contexts.current ? entry : { ...entry, context: contexts.current, namespace: entry.namespace || contexts.contexts.find((c) => c.name === contexts.current)?.namespace || '' };
  const valid = effective.context !== '' && effective.namespace !== '' && effective.pod !== '';
  const add = () => {
    if (!valid) return;
    writeLast(effective);
    setConfig({ ...config, clusters: formatEntries([...entries, effective]) });
    onClose();
  };
  return (
    <Modal
      title={tKey('dash.pods.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tKey('dash.pods.cancel')}</Button>
          <Button variant="primary" disabled={!valid} onClick={add}>
            {tKey('dash.pods.add.confirm')}
          </Button>
        </>
      }
    >
      <div onKeyDown={(e) => e.key === 'Enter' && add()}>
        <PodEntryFields entry={effective} onChange={setEntry} contexts={contexts} namespaces={namespaces} />
      </div>
    </Modal>
  );
}

export function PodsActions({ config, setConfig }: { config: PodsConfig; setConfig?: (next: PodsConfig) => void }) {
  const [open, setOpen] = useState(false);
  if (!setConfig) return null;
  return (
    <>
      <IconButton icon="plus" label={tKey('dash.pods.add')} onClick={() => setOpen(true)} />
      {open && <AddPodDialog config={config} setConfig={setConfig} onClose={() => setOpen(false)} />}
    </>
  );
}
