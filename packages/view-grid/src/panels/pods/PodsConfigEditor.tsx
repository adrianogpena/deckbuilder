import { useState } from 'react';
import { Button, IconButton } from '@deckbuilderkit/ui';
import { ConfigForm } from '../../ConfigForm';
import { tKey } from '../../i18n';
import { PODS_FIELDS } from './fields';
import { formatEntries, parseEntries, type PodEntry } from './model';
import type { PodsConfig } from './PodsPanel';
import { PodEntryFields, usePodChoices } from './PodEntryFields';
import './pods.css';

const OTHER_FIELDS = PODS_FIELDS.filter((f) => f.key !== 'clusters');

function EntryRow({ config, entry, entries, onChange, action }: { config: PodsConfig; entry: PodEntry; entries: readonly PodEntry[]; onChange: (next: PodEntry) => void; action: React.ReactNode }) {
  const { contexts, namespaces } = usePodChoices(config, entry.context, entries.map((e) => e.namespace));
  return (
    <div className="pods-entry-row">
      <PodEntryFields entry={entry} onChange={onChange} contexts={contexts} namespaces={namespaces} compact />
      {action}
    </div>
  );
}

/** Set up and Configure form: one row per tracked pod, an add row, then the other settings. */
export function PodsConfigEditor({ value, onChange }: { value: PodsConfig; onChange: (next: PodsConfig) => void }) {
  const entries = parseEntries(value.clusters ?? '');
  const [draft, setDraft] = useState<PodEntry>({ context: '', namespace: '', pod: '' });
  const save = (next: PodEntry[]) => onChange({ ...value, clusters: formatEntries(next) });
  const valid = draft.context !== '' && draft.namespace !== '' && draft.pod !== '';
  return (
    <div className="pods-editor">
      {entries.map((entry, i) => (
        <EntryRow
          key={i}
          config={value}
          entry={entry}
          entries={entries}
          onChange={(e) => save(entries.map((x, j) => (j === i ? e : x)))}
          action={<IconButton icon="close" label={tKey('dash.pods.entry.remove')} onClick={() => save(entries.filter((_, j) => j !== i))} />}
        />
      ))}
      <EntryRow
        config={value}
        entry={draft}
        entries={entries}
        onChange={setDraft}
        action={
          <Button
            disabled={!valid}
            onClick={() => {
              save([...entries, draft]);
              setDraft({ ...draft, pod: '' });
            }}
          >
            {tKey('dash.pods.entry.add')}
          </Button>
        }
      />
      <ConfigForm fields={OTHER_FIELDS} value={value} onChange={(v) => onChange({ ...value, ...v, clusters: value.clusters } as PodsConfig)} />
    </div>
  );
}
