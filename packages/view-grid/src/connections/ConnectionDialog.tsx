import { useState } from 'react';
import { Button, errorMessage, errorOf, Modal, request } from '@deckbuilderkit/ui';
import { tKey } from '../i18n';
import type { ConnectionType, PublicConnection } from './store';

export type { ConnectionType, PublicConnection };

export interface TestResult {
  ok: boolean;
  user?: string;
  error?: { code: string; message: string };
}

export interface ConnectionDraft {
  id?: string;
  type: ConnectionType;
  name: string;
  baseUrl: string;
  user: string;
  /** Empty keeps the stored token. */
  token: string;
}

const ROUTE = '/api/grid/connections';

export const listConnections = (): Promise<PublicConnection[]> => request<PublicConnection[]>('GET', ROUTE);
export const saveConnection = (draft: ConnectionDraft): Promise<PublicConnection> => request<PublicConnection>('POST', ROUTE, {}, draft);
export const deleteConnection = (id: string): Promise<unknown> => request('DELETE', ROUTE, { id });
export const testConnection = (id: string): Promise<TestResult> => request<TestResult>('POST', `${ROUTE}/test`, {}, { id });

/** The text of a test result: who the credentials belong to, or the translated error. */
export const testText = (r: TestResult): string =>
  r.ok
    ? r.user
      ? tKey('conn.test.okUser', { user: r.user })
      : tKey('conn.test.ok')
    : errorMessage({ kind: 'internal', code: r.error?.code ?? 'raw', message: r.error?.message ?? '' });

/**
 * Edit dialog of one connection (new when `connection` is missing). Save and Test both store it first,
 * so the server tests what is in the form; `onSaved` gets the stored connection.
 */
export function ConnectionDialog({ connection, type, onSaved, onClose }: {
  connection?: PublicConnection;
  /** The type of a new connection when the caller needs one (a picker of one type). */
  type?: ConnectionType;
  onSaved: (saved: PublicConnection) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ConnectionDraft>(() => ({
    id: connection?.id,
    type: connection?.type ?? type ?? 'github',
    name: connection?.name ?? '',
    baseUrl: connection?.baseUrl ?? '',
    user: connection?.user ?? '',
    token: '',
  }));
  const [hasToken, setHasToken] = useState(connection?.hasToken ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string }>();
  const set = (patch: Partial<ConnectionDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const locked = connection !== undefined || draft.id !== undefined || type !== undefined;

  const store = async (): Promise<PublicConnection> => {
    const saved = await saveConnection(draft);
    setDraft((d) => ({ ...d, id: saved.id, token: '' }));
    setHasToken(saved.hasToken);
    return saved;
  };
  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      onSaved(await store());
      onClose();
    } catch (err) {
      setMessage({ tone: 'err', text: errorMessage(errorOf(err)) });
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setMessage({ tone: 'ok', text: tKey('conn.testing') });
    try {
      const saved = await store();
      const result = await testConnection(saved.id);
      setMessage({ tone: result.ok ? 'ok' : 'err', text: testText(result) });
    } catch (err) {
      setMessage({ tone: 'err', text: errorMessage(errorOf(err)) });
    }
    setBusy(false);
  };

  return (
    <Modal
      title={tKey(connection ? 'conn.editTitle' : 'conn.newTitle')}
      onClose={onClose}
      footer={
        <>
          <Button title={tKey('conn.test')} onClick={() => void test()} disabled={busy || !draft.name.trim()}>{tKey('conn.test')}</Button>
          <Button title={tKey('conn.cancel')} onClick={onClose}>{tKey('conn.cancel')}</Button>
          <Button variant="primary" title={tKey('conn.save')} onClick={() => void save()} disabled={busy || !draft.name.trim()}>{tKey('conn.save')}</Button>
        </>
      }
    >
      <div className="grid-config-form">
        <label className="field">
          <span className="mono-label">{tKey('conn.name')}</span>
          <input value={draft.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="mono-label">{tKey('conn.type')}</span>
          <select value={draft.type} disabled={locked} onChange={(e) => set({ type: e.target.value as ConnectionType })}>
            <option value="github">{tKey('conn.type.github')}</option>
            <option value="jira">{tKey('conn.type.jira')}</option>
          </select>
        </label>
        <label className="field">
          <span className="mono-label">{tKey('conn.baseUrl')}</span>
          <input
            value={draft.baseUrl}
            placeholder={draft.type === 'github' ? 'https://api.github.com' : 'https://your-team.atlassian.net'}
            spellCheck={false}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
          <span className="muted">{tKey(draft.type === 'github' ? 'conn.baseUrl.github' : 'conn.baseUrl.jira')}</span>
        </label>
        {draft.type === 'jira' && (
          <label className="field">
            <span className="mono-label">{tKey('conn.user')}</span>
            <input value={draft.user} spellCheck={false} autoComplete="off" onChange={(e) => set({ user: e.target.value })} />
            <span className="muted">{tKey('conn.user.hint')}</span>
          </label>
        )}
        <label className="field">
          <span className="mono-label">{tKey('conn.token')}</span>
          <input
            type="password"
            value={draft.token}
            placeholder={hasToken ? tKey('conn.token.unchanged') : undefined}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => set({ token: e.target.value })}
          />
          {draft.type === 'github' && <span className="muted">{tKey('conn.token.github')}</span>}
        </label>
        <span className="muted">{tKey('conn.test.saved')}</span>
        {message && <p className={message.tone === 'err' ? 'err' : 'muted'} role="status">{message.text}</p>}
      </div>
    </Modal>
  );
}
