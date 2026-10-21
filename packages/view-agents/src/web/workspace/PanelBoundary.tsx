import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Icon } from '@deckbuilderkit/ui';
import { t } from '../../i18n';

interface State {
  error?: Error;
}

/** A panel that throws renders an error card with Reload; the rest of the view stays up. */
export class PanelBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Agents panel crashed', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="agents-dock-card" role="alert">
        <span className="agents-dock-card-icon" aria-hidden><Icon name="alert" size={28} /></span>
        <h2 className="agents-dock-card-title">{t('workspace.crashed')}</h2>
        <p className="agents-dock-card-desc">{error.message}</p>
        <div className="agents-dock-card-actions">
          <Button variant="primary" icon="rotate-ccw" onClick={() => this.setState({ error: undefined })}>{t('workspace.reload')}</Button>
        </div>
      </div>
    );
  }
}
