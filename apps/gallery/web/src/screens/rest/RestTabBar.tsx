import { Icon } from '@deckbuilder/ui';
import type { SavedRequest } from '../../api';
import { t } from '../../i18n';
import { isDirty, type RestTab, restTabs } from './tabs-store';

const tabLabel = (tab: RestTab, saved: SavedRequest[] | undefined) => {
  const name = (tab.savedId && saved?.find((r) => r.id === tab.savedId)?.name) || tab.title || tab.draft.url.trim();
  return `${tab.draft.method} ${name || t('rest.tab.untitled')}`;
};

/** The REST screen's open requests: click to focus, × or middle-click to close, + for a new one. */
export function RestTabBar({ tabs, active, saved }: { tabs: RestTab[]; active: string; saved: SavedRequest[] | undefined }) {
  return (
    <div className="tabbar" role="tablist">
      <div className="tabs-strip">
        {tabs.map((tab) => {
          const label = tabLabel(tab, saved);
          const dirty = isDirty(tab, saved);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active}
              className={`tab-chip${tab.id === active ? ' active' : ''}${dirty ? ' dirty' : ''}`}
              title={tab.draft.url || label}
              onClick={() => restTabs.activate(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1) restTabs.close(tab.id);
              }}
            >
              <span className="tab-title">{label}</span>
              <button
                className="tab-close"
                title={t('rest.tab.close')}
                aria-label={t('rest.tab.close')}
                onClick={(e) => {
                  e.stopPropagation();
                  restTabs.close(tab.id);
                }}
              >
                {dirty && <span className="tab-dot" title={t('rest.tab.unsaved')} aria-label={t('rest.tab.unsaved')}>●</span>}
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn btn-ghost btn-sm tab-new btn-icon" onClick={restTabs.newTab} title={t('rest.tab.new')} aria-label={t('rest.tab.new')}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
