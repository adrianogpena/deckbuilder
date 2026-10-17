import type { PermissionDecision, PermissionRequest } from '../../chat-protocol.ts';
import { t } from '../../i18n';
import { toolSummary } from './chat-model';

/** A pending tool permission from the permission MCP: Allow, Always (this chat) or Deny. */
export function PermissionCard({ request, onAnswer }: { request: PermissionRequest; onAnswer(requestId: string, decision: PermissionDecision): void }) {
  const answer = (d: PermissionDecision) => onAnswer(request.id, d);
  return (
    <div className="chat-permission" role="alertdialog" aria-label={t('agents.chat.permission.title', { tool: request.toolName })}>
      <div className="chat-permission-head">
        <span className="agents-dot needs-you" aria-hidden="true" />
        <strong>{t('agents.chat.permission.title', { tool: request.toolName })}</strong>
        <span className="chat-tool-summary">{toolSummary(request.input)}</span>
      </div>
      <details>
        <summary>{t('agents.chat.permission.details')}</summary>
        <pre className="chat-tool-input">{JSON.stringify(request.input, null, 2)}</pre>
      </details>
      <div className="chat-permission-actions">
        <button type="button" className="primary" onClick={() => answer('allow')}>{t('agents.chat.permission.allow')}</button>
        <button type="button" onClick={() => answer('always')} title={t('agents.chat.permission.always.hint')}>{t('agents.chat.permission.always')}</button>
        <button type="button" className="danger" onClick={() => answer('deny')}>{t('agents.chat.permission.deny')}</button>
      </div>
    </div>
  );
}
