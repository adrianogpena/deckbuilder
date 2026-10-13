import { GLOBAL, KeybindingsEditor, Modal, useKeybindings } from '@deckbuilder/ui';
import type { Settings } from '../api';
import { t } from '../i18n';
import { NAV } from '../nav';

/**
 * Every command of the app, with the keys the user can change; a change applies at once. Like VS Code's Keyboard
 * Shortcuts editor it is a modal of its own over the current screen, not a Settings section.
 */
export function KeysModal({ settings, onSave, onClose }: { settings: Settings; onSave: (patch: Partial<Settings>) => void; onClose: () => void }) {
  const keys = useKeybindings();
  if (!keys) return null;
  const screens = NAV.flatMap((s) => s.items);
  const scopeLabel = (scope: string) => (scope === GLOBAL ? t('keys.global') : t(screens.find((i) => i.id === scope)?.label ?? 'nav.home'));
  return (
    <Modal title={t('nav.keys')} onClose={onClose} large>
      <div className="scroll keys-modal-body">
        <KeybindingsEditor defs={keys.defs} keymap={settings.keybindings ?? {}} onChange={(keybindings) => onSave({ keybindings })} scopeLabel={scopeLabel} />
      </div>
    </Modal>
  );
}
