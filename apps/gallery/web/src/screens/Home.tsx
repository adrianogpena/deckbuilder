import { useState, type ReactNode } from 'react';
import { type ApiError, Badge, CopyButton, ErrorBanner, errorOf, Icon, isDesktop, PageHead, Spinner, useAsync } from '@deckbuilder/ui';
import { api } from '../api';
import { t } from '../i18n';

export function Home() {
  const info = useAsync(() => api.info(), []);

  return (
    <div className="content">
      <PageHead title={t('home.title')}>
        <button className="btn btn-sm" onClick={info.reload}><Icon name="refresh" /> {t('common.retry')}</button>
      </PageHead>
      <div className="scroll">
        {info.error && <ErrorBanner error={info.error} onRetry={info.reload} />}
        {!info.data && !info.error && <Spinner />}
        {info.data && (
          <section className="section">
            <h4 className="mono-label">{t('home.system')}</h4>
            <div className="facts">
              <Fact label={t('home.version')}><span className="mono">{info.data.version}</span></Fact>
              <Fact label={t('home.mode')}>
                <Badge tone={isDesktop ? 'ok' : 'info'}>{isDesktop ? t('home.mode.desktop') : t('home.mode.browser')}</Badge>
              </Fact>
              <Fact label={t('home.platform')}><span className="mono">{info.data.platform} / {info.data.arch}</span></Fact>
              <Fact label={t('home.host')}>{info.data.hostname}</Fact>
              <Fact label={t('home.runtime')}>
                <span className="mono">bun {info.data.bun}</span>
              </Fact>
              <Fact label={t('home.started')}>{new Date(info.data.startedAt).toLocaleString()}</Fact>
              <Fact label={t('home.dataDir')}>
                <span className="fact-row"><span className="mono">{info.data.dataDir}</span><CopyButton text={info.data.dataDir} label="" /></span>
              </Fact>
            </div>
          </section>
        )}
        <ToastCard />
        <EchoCard />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  );
}

function ToastCard() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError>();

  async function send() {
    setBusy(true);
    setSent(false);
    setError(undefined);
    try {
      await api.testToast();
      setSent(true);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h4 className="mono-label">{t('home.toast')}</h4>
      <div className="card">
        <p className="muted small">{t('home.toastHint')}</p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void send()}>
            {busy ? <Spinner small /> : <Icon name="send" />} {t('home.toastSend')}
          </button>
        </div>
        {error && <ErrorBanner error={error} compact />}
        {sent && <p className="tone-ok small">{t('home.toastSent')}</p>}
      </div>
    </section>
  );
}

function EchoCard() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ length: number; at: string }>();
  const [error, setError] = useState<ApiError>();

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.echo(text));
    } catch (err) {
      setResult(undefined);
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h4 className="mono-label">{t('home.echo')}</h4>
      <div className="card">
        <p className="muted small">{t('home.echoHint')}</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('home.echoPlaceholder')} />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner small /> : <Icon name="send" />} {t('home.send')}
          </button>
        </form>
        {error && <ErrorBanner error={error} compact />}
        {result && <p className="tone-ok small">{t('home.echoResult', { length: result.length, at: new Date(result.at).toLocaleTimeString() })}</p>}
      </div>
    </section>
  );
}
