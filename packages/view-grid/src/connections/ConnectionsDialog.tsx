import { useCallback, useEffect, useState } from 'react';
import { Button, errorMessage, errorOf, Modal, useDialogs } from '@deckbuilderkit/ui';
import { tKey } from '../i18n';
import { ConnectionDialog, deleteConnection, listConnections, testConnection, testText, type PublicConnection } from './ConnectionDialog';

/** Lists the connections with Edit, Test and Delete, and adds new ones. */
export function ConnectionsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<PublicConnection[]>([]);
  const [editing, setEditing] = useState<PublicConnection | 'new'>();
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const { confirm, element } = useDialogs();

  const reload = useCallback(() => {
    listConnections().then(setList, (err) => setResults((r) => ({ ...r, '': { ok: false, text: errorMessage(errorOf(err)) } })));
  }, []);
  useEffect(reload, [reload]);

  const test = async (c: PublicConnection) => {
    setResults((r) => ({ ...r, [c.id]: { ok: true, text: tKey('conn.testing') } }));
    try {
      const result = await testConnection(c.id);
      setResults((r) => ({ ...r, [c.id]: { ok: result.ok, text: testText(result) } }));
    } catch (err) {
      setResults((r) => ({ ...r, [c.id]: { ok: false, text: errorMessage(errorOf(err)) } }));
    }
  };
  const remove = async (c: PublicConnection) => {
    const ok = await confirm({ title: tKey('conn.deleteTitle'), body: tKey('conn.deleteBody', { name: c.name }), okLabel: tKey('conn.delete'), danger: true });
    if (!ok) return;
    try {
      await deleteConnection(c.id);
    } catch (err) {
      setResults((r) => ({ ...r, [c.id]: { ok: false, text: errorMessage(errorOf(err)) } }));
    }
    reload();
  };

  return (
    <Modal
      title={tKey('conn.title')}
      onClose={onClose}
      footer={
        <>
          <Button icon="plus" title={tKey('conn.add')} onClick={() => setEditing('new')}>{tKey('conn.add')}</Button>
          <Button variant="primary" title={tKey('conn.close')} onClick={onClose}>{tKey('conn.close')}</Button>
        </>
      }
    >
      <div className="grid-config-form">
        {results['']?.ok === false && <p className="err" role="status">{results[''].text}</p>}
        {list.length === 0 && <p className="muted">{tKey('conn.empty')}</p>}
        {list.map((c) => (
          <div key={c.id} className="field">
            <span className="mono-label">{`${c.name} · ${tKey(`conn.type.${c.type}`)}`}</span>
            <span className="muted">{c.baseUrl}{c.hasToken ? ` · ${tKey('conn.hasToken')}` : ''}</span>
            <span className="grid-config-date">
              <Button size="sm" icon="edit" title={tKey('conn.edit')} onClick={() => setEditing(c)}>{tKey('conn.edit')}</Button>
              <Button size="sm" icon="check" title={tKey('conn.test')} onClick={() => void test(c)}>{tKey('conn.test')}</Button>
              <Button size="sm" icon="trash" title={tKey('conn.delete')} onClick={() => void remove(c)}>{tKey('conn.delete')}</Button>
            </span>
            {results[c.id] && <span className={results[c.id]!.ok ? 'muted' : 'err'} role="status">{results[c.id]!.text}</span>}
          </div>
        ))}
      </div>
      {editing && <ConnectionDialog connection={editing === 'new' ? undefined : editing} onSaved={reload} onClose={() => { setEditing(undefined); reload(); }} />}
      {element}
    </Modal>
  );
}
