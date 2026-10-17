import { Composer } from './Composer';
import { PermissionCard } from './PermissionCard';
import { Transcript } from './Transcript';
import { chatErrorText, useChat, type ChatTarget } from './useChat';
import { t } from '../../i18n';

export interface ChatPaneProps extends ChatTarget {
  /** Called with the Claude session id once known (on `opened`, or the `init` event of a new chat). */
  onSession?(sessionId: string): void;
}

/** Chat mode for one Claude session: transcript, pending permission cards and the composer. */
export function ChatPane({ onSession, ...target }: ChatPaneProps) {
  const chat = useChat(target, onSession);
  const running = chat.state?.run === 'running';
  const closed = chat.state?.run === 'closed';
  return (
    <div className="chat-pane">
      <Transcript events={chat.events} />
      {chat.error && (
        <div className="chat-banner error" role="alert">
          <span>{chatErrorText(chat.error)}</span>
          <button type="button" className="chat-icon" aria-label={t('agents.chat.dismiss')} title={t('agents.chat.dismiss')} onClick={chat.clearError}>x</button>
        </div>
      )}
      {!chat.connected && !chat.error && <div className="chat-banner">{chat.opened ? t('agents.chat.disconnected') : t('agents.chat.connecting')}</div>}
      {chat.state?.permissions.map((p) => <PermissionCard key={p.id} request={p} onAnswer={chat.answer} />)}
      <Composer
        running={running}
        disabled={!chat.connected || closed}
        queue={chat.state?.queue ?? []}
        onSend={chat.sendText}
        onInterrupt={chat.interrupt}
        onEditQueued={chat.editQueued}
        onRemoveQueued={chat.removeQueued}
      />
    </div>
  );
}
