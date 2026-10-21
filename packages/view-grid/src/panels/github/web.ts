import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { IssuesPanel, type IssuesConfig } from './Issues';
import { PullRequestsPanel, type PullRequestsConfig } from './PullRequests';
import { ISSUES_FIELDS, PULL_REQUESTS_FIELDS } from './fields';
import { searchRefreshMs, type IssueItem, type PrItem, type SearchData } from './map';

const prsPanel = definePanel<PullRequestsConfig, SearchData<PrItem>>({
  kind: 'github-prs',
  title: 'dash.github.panel.prs',
  description: 'dash.github.panel.prs.description',
  icon: 'link',
  category: 'dash.category.github',
  size: { w: 8, h: 14, minW: 4, minH: 6 },
  config: { fields: PULL_REQUESTS_FIELDS },
  load: (config) => fetchSource<SearchData<PrItem>>('github-prs', config),
  refreshMs: (_config, data) => searchRefreshMs(data),
  render: ({ config, data }) => createElement(PullRequestsPanel, { config, data }),
});

const issuesPanel = definePanel<IssuesConfig, SearchData<IssueItem>>({
  kind: 'github-issues',
  title: 'dash.github.panel.issues',
  description: 'dash.github.panel.issues.description',
  icon: 'log',
  category: 'dash.category.github',
  size: { w: 8, h: 14, minW: 4, minH: 6 },
  config: { fields: ISSUES_FIELDS },
  load: (config) => fetchSource<SearchData<IssueItem>>('github-issues', config),
  refreshMs: (_config, data) => searchRefreshMs(data),
  render: ({ config, data }) => createElement(IssuesPanel, { config, data }),
});

/** The github panel kinds. */
export const panels: AnyPanelKind[] = [prsPanel, issuesPanel];
