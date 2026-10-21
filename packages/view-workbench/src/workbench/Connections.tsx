import { useState } from 'react';
import { type ApiError, Badge, Button, errorOf, ErrorBanner, type FieldSpec, Modal, ResourceForm, ResourceList, Spinner, useAsync } from '@deckbuilderkit/ui';
import type { DbConnection } from '@deckbuilderkit/sql-ui';
import type { WorkbenchClient } from '../client';
import { t } from '../i18n';

type Mode = { kind: 'list' } | { kind: 'form'; item?: DbConnection };

/** Manages the Oracle connection records; the password field shows "Saved" and never the value. */
export function Connections({ client, onClose, onChanged }: { client: WorkbenchClient; onClose: () => void; onChanged: () => void }) {
  const connections = useAsync(() => client.connections(), []);
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

  const needsPassword = (values: Record<string, unknown>) => {
    const item = mode.kind === 'form' ? mode.item : undefined;
    return !!item && (values.url !== item.url || values.user !== item.user) && !values.password;
  };

  const submit = async (values: Record<string, unknown>) => {
    setError(undefined);
    if (needsPassword(values)) {
      setError({ code: 'badRequest', message: t('workbench.conn.passwordRequired') } as ApiError);
      return;
    }
    try {
      if (mode.kind === 'form' && mode.item) await client.updateConnection(mode.item.id, values);
      else await client.createConnection(values);
      connections.reload();
      onChanged();
      setMode({ kind: 'list' });
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const remove = async (item: DbConnection) => {
    try {
      await client.deleteConnection(item.id);
      connections.reload();
      onChanged();
    } catch (err) {
      setError(errorOf(err));
    }
  };

  const test = async (values: Record<string, unknown>) => {
    setTested(undefined);
    if (needsPassword(values)) {
      setTested({ code: 'badRequest', message: t('workbench.conn.passwordRequired') } as ApiError);
      return;
    }
    setTesting(true);
    try {
      await client.testConnection(mode.kind === 'form' && mode.item ? { ...values, id: mode.item.id } : values);
      setTested('ok');
    } catch (err) {
      setTested(errorOf(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title={t('workbench.conn.title')} onClose={onClose} footer={<Button onClick={onClose} title={t('workbench.conn.close')}>{t('workbench.conn.close')}</Button>}>
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
              <Button className="wb-test-btn" icon="refresh" onClick={() => test(values())} disabled={testing} title={t('workbench.conn.test')}>
                {t('workbench.conn.test')}
              </Button>
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
