import { useState } from 'react';
import { type ApiError, Badge, errorOf, ErrorBanner, type FieldSpec, Icon, Modal, ResourceForm, ResourceList, Spinner, useAsync } from '@deckbuilder/ui';
import { api, type DbConnection } from '../../api';
import { t } from '../../i18n';

type Mode = { kind: 'list' } | { kind: 'form'; item?: DbConnection };

/** Manages the Oracle connection records; the password field shows "Saved" and never the value. */
export function Connections({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const connections = useAsync(() => api.dbConnections(), []);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [error, setError] = useState<ApiError>();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | ApiError>();

  const fields: FieldSpec[] = [
    { key: 'name', label: t('workbench.conn.name'), kind: 'text', required: true },
    { key: 'url', label: t('workbench.conn.url'), kind: 'text', required: true, placeholder: 'oracle:thin:@host:1521/SERVICE' },
    { key: 'user', label: t('workbench.conn.user'), kind: 'text', required: true },
    { key: 'password', label: t('workbench.conn.password'), kind: 'password' },
  ];

  const open = (item?: DbConnection) => {
    setError(undefined);
    setTested(undefined);
    setMode({ kind: 'form', item });
  };

  const submit = async (values: Record<string, unknown>) => {
    setError(undefined);
    try {
      if (mode.kind === 'form' && mode.item) await api.updateDbConnection(mode.item.id, values);
      else await api.createDbConnection(values);
      connections.reload();
      onChanged();
      setMode({ kind: 'list' });
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const remove = async (item: DbConnection) => {
    try {
      await api.deleteDbConnection(item.id);
      connections.reload();
      onChanged();
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const test = async (values: Record<string, unknown>) => {
    setTesting(true);
    setTested(undefined);
    try {
      await api.dbTest(mode.kind === 'form' && mode.item ? { ...values, id: mode.item.id } : values);
      setTested('ok');
    } catch (err) {
      setTested(errorOf(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title={t('workbench.conn.title')} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('workbench.conn.close')}</button>}>
      {mode.kind === 'list' ? (
        <>
          {error && <ErrorBanner error={error} compact />}
          {connections.data ? (
            <ResourceList<DbConnection>
              items={connections.data}
              titleOf={(c) => c.name}
              subtitleOf={(c) => `${c.user} @ ${c.url}`}
              iconOf={() => 'database'}
              onOpen={(c) => open(c)}
              onEdit={(c) => open(c)}
              onDelete={remove}
              onAdd={() => open()}
              emptyTitle={t('workbench.conn.empty')}
            />
          ) : (
            <Spinner />
          )}
        </>
      ) : (
        <>
          <p className="muted">{t('workbench.conn.urlHint')}</p>
          <ResourceForm
            fields={fields}
            value={{ ...mode.item }}
            onSubmit={submit}
            onCancel={() => setMode({ kind: 'list' })}
            error={error}
            actions={(values) => (
              <button type="button" className="btn wb-test-btn" onClick={() => test(values())} disabled={testing}>
                <Icon name="refresh" /> {t('workbench.conn.test')}
              </button>
            )}
          />
          {(testing || tested) && (
            <div className="row wb-test">
              {testing && <Spinner small />}
              {tested === 'ok' && <Badge tone="ok">{t('workbench.conn.connected')}</Badge>}
              {tested && tested !== 'ok' && <ErrorBanner error={tested} compact />}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
