import { useShortcutTip } from '@deckbuilderkit/ui';
import { t } from '../i18n';

/** Exit codes that read as a normal stop: 0, Ctrl+C (130), SIGTERM (143) and Windows Ctrl+C (0xC000013A). */
const CLEAN_EXITS = new Set([0, 130, 143, 3221225786]);

/** True when the exit reads as "Session stopped" rather than a crash. */
export const cleanExit = (code: number | null | undefined, userStopped = false): boolean => userStopped || (code != null && CLEAN_EXITS.has(code));

/** Bar under an exited session (spec S8): exit text, Restart and Close. A non-zero exit gets the danger tint. */
export function ExitBar({ code, userStopped, onRestart, onClose }: { code: number | null | undefined; userStopped?: boolean; onRestart(): void; onClose(): void }) {
  const tip = useShortcutTip();
  const clean = cleanExit(code, userStopped);
  return (
    <div className={`agents-bar agents-exit-bar${clean ? '' : ' is-error'}`} role="status">
      <span className="agents-bar-text">{clean ? t('agents.exitBar.stopped') : t('agents.exitBar.exited', { code: code == null ? '?' : String(code) })}</span>
      <button type="button" className="agents-bar-btn" title={tip(t('agents.exitBar.restart'), 'agents.restart')} onClick={onRestart}>{t('agents.exitBar.restart')}</button>
      <button type="button" className="agents-bar-btn" title={t('agents.exitBar.close')} onClick={onClose}>{t('agents.exitBar.close')}</button>
    </div>
  );
}
