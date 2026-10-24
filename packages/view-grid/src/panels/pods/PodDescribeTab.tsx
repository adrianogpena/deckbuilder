import { useEffect, useState } from 'react';
import { IconButton } from '@deckbuilderkit/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import type { PodTarget } from './PodOverview';
import type { PodsConfig } from './PodsPanel';
import './pods.css';

/** Describe tab of a pod in the side panel; loads once, reloads on demand. */
export function PodDescribeTab({ config, target }: { config: PodsConfig; target: PodTarget }) {
  const [text, setText] = useState<string>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setText(undefined);
    runAction<string>('pods', 'describe', config, target).then(
      (value) => live && setText(value),
      (err) => live && setText(String((err as Error)?.message ?? err)),
    );
    return () => {
      live = false;
    };
  }, [target.context, target.namespace, target.pod, nonce]);

  return (
    <div className="pod-describe">
      <div className="pod-describe-bar">
        <IconButton icon="refresh" label={tKey('dash.pods.reload')} onClick={() => setNonce((n) => n + 1)} />
      </div>
      <pre className="pod-describe-text">{text ?? tKey('dash.pods.describe.loading')}</pre>
    </div>
  );
}
