import { createContext } from 'react';
import type { EditorOptions } from './editorOptions';

export const EditorOptionsContext = createContext<EditorOptions | undefined>(undefined);
