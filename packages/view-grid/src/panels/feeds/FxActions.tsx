import { IconButton } from '@kedalion/ui';
import { tKey } from '../../i18n';
import type { PanelSide } from '../../panel';
import type { FxConfig } from './ExchangeRate';
import { fxSideContent } from './FxSide';

export function FxActions({ config, side }: { config: FxConfig; side?: PanelSide }) {
  if (!side) return null;
  return <IconButton icon="history" label={tKey('dash.feeds.fx.history')} onClick={() => side.open(fxSideContent(config))} />;
}
