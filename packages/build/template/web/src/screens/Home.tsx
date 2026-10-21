import type { ReactNode } from 'react';
import { Badge, Button, CopyButton, ErrorBanner, isDesktop, PageHead, Spinner, useAsync } from '@deckbuilderkit/ui';
import { api } from '../api';
import { t } from '../i18n';

export function Home() {
  const info = useAsync(() => api.info(), []);

  return (
    <div className="content">
      <PageHead title={t('home.title')}>
        <Button size="sm" icon="refresh" title={t('common.retry')} onClick={info.reload}>{t('common.retry')}</Button>
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
