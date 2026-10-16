import { useEffect, useState } from 'react';
import type { RestEnvironment, RestEnvVarInput } from '@deckbuilder/server-core/protocol';
import { type ApiError, ErrorBanner, errorOf, Icon, Modal, useDialogs, useToast } from '@deckbuilder/ui';
import { restApi as api } from '../client';
import { t } from '../i18n';

/** A variable row being edited. `from`: its stored name (secret kept on rename); `replace`: a secret whose value is being typed. */
interface Row {
  name: string;
  value: string;
  secret: boolean;
  enabled: boolean;
  set: boolean;
  from?: string;
  replace: boolean;
}

const toRows = (env: RestEnvironment | undefined): Row[] =>
  (env?.vars ?? []).map((v) => ({ name: v.name, value: v.value, secret: v.secret, enabled: v.enabled, set: !!v.set, from: v.name, replace: false }));

const toInput = (rows: Row[]): RestEnvVarInput[] =>
  rows
    .filter((r) => r.name.trim() || r.value)
    .map((r) => {
      const base = { name: r.name.trim(), secret: r.secret, enabled: r.enabled };
      if (!r.secret || r.replace) return { ...base, value: r.value };
      return r.from && r.from !== base.name ? { ...base, from: r.from } : base;
    });

const blank = (): Row => ({ name: '', value: '', secret: false, enabled: true, set: false, replace: false });

interface Props {
  environments: RestEnvironment[] | undefined;
  /** The list changed on the server; reload it. */
  onChanged: () => void;
  /** Environment `id` was deleted (clear it when active). */
  onDeleted: (id: string) => void;
  onClose: () => void;
}

/** "Manage environments…": add, rename and delete environments and edit their variables; secret values are write-only. */
export function EnvironmentsDialog({ environments, onChanged, onDeleted, onClose }: Props) {
  const { confirm, prompt, element } = useDialogs();
  const toast = useToast();
  const [selected, setSelected] = useState<string | undefined>(environments?.[0]?.id);
  const env = environments?.find((e) => e.id === selected);
  const [rows, setRows] = useState<Row[]>(() => toRows(env));
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(toRows(env));

  useEffect(() => {
    if (!env && environments?.length) setSelected(environments[0]!.id);
  }, [env, environments]);
  useEffect(() => setRows(toRows(env)), [env]);

  const discardOk = async () => !dirty || (await confirm({ title: t('rest.env.discard'), okLabel: t('rest.env.discardOk'), danger: true }));

  const select = async (id: string) => {
    if (id === selected || !(await discardOk())) return;
    setError(undefined);
    setSelected(id);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const askName = (title: string, value: string) =>
    prompt({ title, label: t('rest.env.name'), value, validate: (v) => (v.trim() ? null : t('error.badEnvironmentName')) });

  const add = async () => {
    if (!(await discardOk())) return;
    const name = await askName(t('rest.env.addTitle'), '');
    if (!name) return;
    await run(async () => {
      const created = await api.createRestEnvironment({ name: name.trim(), vars: [] });
      setSelected(created.id);
      onChanged();
    });
  };

  const rename = async () => {
    if (!env || !(await discardOk())) return;
    const name = await askName(t('rest.env.renameTitle'), env.name);
    if (!name || name.trim() === env.name) return;
    await run(async () => {
      await api.updateRestEnvironment(env.id, { name: name.trim(), vars: toInput(toRows(env)) });
      onChanged();
    });
  };

  const remove = async () => {
    if (!env) return;
    if (!(await confirm({ title: t('rest.env.deleteTitle', { name: env.name }), okLabel: t('rest.delete'), danger: true }))) return;
    await run(async () => {
      await api.deleteRestEnvironment(env.id);
      setSelected(environments?.find((e) => e.id !== env.id)?.id);
      onDeleted(env.id);
      onChanged();
    });
  };

  const save = () =>
    env &&
    run(async () => {
      await api.updateRestEnvironment(env.id, { name: env.name, vars: toInput(rows) });
      onChanged();
      toast({ message: t('rest.env.saved', { name: env.name }) });
    });

  const close = async () => {
    if (await discardOk()) onClose();
  };

  const patch = (i: number, change: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

  const footer = (
    <>
      <button className="btn" onClick={() => void close()}>{t('rest.import.close')}</button>
      <button className="btn btn-primary" disabled={busy || !env || !dirty} onClick={() => void save()}>{t('rest.save')}</button>
    </>
  );

  return (
    <Modal title={t('rest.env.title')} onClose={() => void close()} footer={footer}>
      {error && <ErrorBanner error={error} compact />}
      <div className="rest-env">
        <aside className="rest-env-list">
          <div className="rest-list-head">
            <span className="mono-label">{t('rest.env.list')}</span>
            <button className="btn btn-sm" disabled={busy} onClick={() => void add()}><Icon name="plus" /> {t('rest.new')}</button>
          </div>
          {environments?.length === 0 && <p className="muted">{t('rest.env.empty')}</p>}
          {environments?.map((e) => (
            <div key={e.id} className={`rest-item${e.id === selected ? ' active' : ''}`}>
              <button className="rest-item-main" onClick={() => void select(e.id)}>
                <span className="rest-item-name">{e.name}</span>
              </button>
              {e.id === selected && (
                <span className="rest-item-actions">
                  <button className="btn btn-ghost btn-sm btn-icon" disabled={busy} onClick={() => void rename()} aria-label={t('rest.rename')} title={t('rest.rename')}>
                    <Icon name="edit" />
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" disabled={busy} onClick={() => void remove()} aria-label={t('rest.delete')} title={t('rest.delete')}>
                    <Icon name="trash" />
                  </button>
                </span>
              )}
            </div>
          ))}
        </aside>
        {env && (
          <div className="rest-env-vars">
            <table className="rest-env-table">
              <thead>
                <tr>
                  <th>{t('rest.env.var.enabled')}</th>
                  <th>{t('rest.env.var.name')}</th>
                  <th>{t('rest.env.var.value')}</th>
                  <th>{t('rest.env.var.secret')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" checked={r.enabled} aria-label={t('rest.env.var.enabled')} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                    </td>
                    <td>
                      <input value={r.name} spellCheck={false} aria-label={t('rest.env.var.name')} onChange={(e) => patch(i, { name: e.target.value })} />
                    </td>
                    <td>
                      {r.secret && !r.replace ? (
                        <span className="row">
                          <span className="muted">{r.set ? t('rest.env.var.set') : t('rest.env.var.notSet')}</span>
                          <button className="btn btn-ghost btn-sm" onClick={() => patch(i, { replace: true, value: '' })}>{t('rest.env.var.replace')}</button>
                        </span>
                      ) : (
                        <input
                          type={r.secret ? 'password' : 'text'}
                          value={r.value}
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={t('rest.env.var.value')}
                          onChange={(e) => patch(i, { value: e.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.secret}
                        aria-label={t('rest.env.var.secret')}
                        // A stored secret turned plain is not revealed: its value starts empty.
                        onChange={(e) => patch(i, e.target.checked ? { secret: true, replace: true } : { secret: false, replace: false, value: r.secret && !r.replace ? '' : r.value })}
                      />
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('rest.env.var.remove')} title={t('rest.env.var.remove')}>
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <button className="btn btn-sm" onClick={() => setRows([...rows, blank()])}><Icon name="plus" /> {t('rest.env.var.add')}</button>
            </div>
            <p className="muted">{t('rest.env.hint')}</p>
          </div>
        )}
      </div>
      {element}
    </Modal>
  );
}
