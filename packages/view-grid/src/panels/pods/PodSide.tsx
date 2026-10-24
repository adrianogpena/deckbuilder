import { copyText, IconButton, type SidePanelContent } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { requestRefresh } from '../../panel';
import { runAction } from '../../source';
import { PodDescribeTab } from './PodDescribeTab';
import { PodLogsTab } from './PodLogsTab';
import { PodOverview } from './PodOverview';
import type { Pod } from './model';
import type { PodsConfig } from './PodsPanel';
import './pods.css';

export interface PodSideInput {
  instanceId: string;
  pod: Pod;
  config: PodsConfig;
}

/** What the Pods panel opens in the Dashboard side panel for one pod. Tabs: overview, logs, describe. */
export function podSideContent({ instanceId, pod, config }: PodSideInput): SidePanelContent {
  const target = { context: pod.context, namespace: pod.namespace, pod: pod.name };
  const restart = async () => {
    try {
      await runAction('pods', 'restart', config, target);
    } finally {
      requestRefresh('pods');
    }
  };
  return {
    id: `${instanceId}:${pod.context}/${pod.namespace}/${pod.name}`,
    title: pod.name,
    subtitle: `${pod.context} / ${pod.namespace}`,
    icon: 'cube',
    tabs: [
      { id: 'overview', label: tKey('dash.pods.tab.overview'), render: () => <PodOverview config={config} target={target} pod={pod} /> },
      { id: 'logs', label: tKey('dash.pods.tab.logs'), render: () => <PodLogsTab target={target} /> },
      { id: 'describe', label: tKey('dash.pods.tab.describe'), render: () => <PodDescribeTab config={config} target={target} /> },
    ],
    actions: (
      <>
        <IconButton icon="rotate-ccw" label={tKey('dash.pods.restart')} onClick={() => void restart()} />
        <IconButton icon="copy" label={tKey('dash.pods.copyName')} onClick={() => void copyText(pod.name)} />
        {pod.urls.map((url) => (
          <IconButton
            key={url}
            icon="link"
            label={tKey('dash.pods.openUrl', { url })}
            onClick={() => window.open(url, '_blank', 'noreferrer')}
          />
        ))}
      </>
    ),
  };
}
