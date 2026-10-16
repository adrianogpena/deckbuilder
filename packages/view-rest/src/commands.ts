import type { CommandDef } from '@deckbuilder/ui';
import { t } from './i18n';

export const restCommands = (): CommandDef[] => [{ id: 'rest.save', scope: 'rest', label: t('keys.rest.save'), keys: ['Ctrl+S'], inInput: true }];
