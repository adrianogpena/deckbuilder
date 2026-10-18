import { codeBlockFeature } from './codeBlock';
import type { RichFeature } from './commands';
import { formatFeature } from './format';
import { mermaidFeature } from './mermaid';
import { navFeature } from './nav';
import { tablesFeature } from './tables';
import { toolbarFeature } from './Toolbar';
import { viewFeature } from './view';

/** The rich pane's features, in the order their plugins load and their handlers are asked. */
export const FEATURES: readonly RichFeature[] = [formatFeature, toolbarFeature, tablesFeature, codeBlockFeature, mermaidFeature, navFeature, viewFeature];
