export interface SqlFormatOptions {
  keywordCase: 'upper' | 'lower' | 'preserve';
  functionCase: 'upper' | 'lower' | 'preserve';
  indent: 2 | 4 | 'tab';
  columnsPerLine: number;
  newlineAfterSelect: boolean;
  singleColumnInline: boolean;
  conditionPerLine: boolean;
  andOrPosition: 'before' | 'after';
  joinConditionOnNewLine: boolean;
  caseLayout: 'auto' | 'always' | 'never';
  caseMaxWidth: number;
  groupOrderListPerLine: boolean;
  fromTablesPerLine: boolean;
  setItemsPerLine: boolean;
  spaceAroundOperators: boolean;
  subqueryNewlineAfterParen: boolean;
  subqueryCloseParenOnOwnLine: boolean;
  blankLineBetweenStatements: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: SqlFormatOptions = {
  keywordCase: 'upper',
  functionCase: 'preserve',
  indent: 2,
  columnsPerLine: 3,
  newlineAfterSelect: false,
  singleColumnInline: true,
  conditionPerLine: false,
  andOrPosition: 'before',
  joinConditionOnNewLine: true,
  caseLayout: 'auto',
  caseMaxWidth: 60,
  groupOrderListPerLine: false,
  fromTablesPerLine: true,
  setItemsPerLine: true,
  spaceAroundOperators: true,
  subqueryNewlineAfterParen: true,
  subqueryCloseParenOnOwnLine: true,
  blankLineBetweenStatements: true,
};

export interface FormatOptionMeta {
  key: keyof SqlFormatOptions;
  kind: 'boolean' | 'enum' | 'number';
  values?: readonly (string | number)[];
  min?: number;
}

const CASES = ['upper', 'lower', 'preserve'] as const;

export const FORMAT_OPTION_META: readonly FormatOptionMeta[] = [
  { key: 'keywordCase', kind: 'enum', values: CASES },
  { key: 'functionCase', kind: 'enum', values: CASES },
  { key: 'indent', kind: 'enum', values: [2, 4, 'tab'] },
  { key: 'columnsPerLine', kind: 'number', min: 1 },
  { key: 'newlineAfterSelect', kind: 'boolean' },
  { key: 'singleColumnInline', kind: 'boolean' },
  { key: 'conditionPerLine', kind: 'boolean' },
  { key: 'andOrPosition', kind: 'enum', values: ['before', 'after'] },
  { key: 'joinConditionOnNewLine', kind: 'boolean' },
  { key: 'caseLayout', kind: 'enum', values: ['auto', 'always', 'never'] },
  { key: 'caseMaxWidth', kind: 'number', min: 1 },
  { key: 'groupOrderListPerLine', kind: 'boolean' },
  { key: 'fromTablesPerLine', kind: 'boolean' },
  { key: 'setItemsPerLine', kind: 'boolean' },
  { key: 'spaceAroundOperators', kind: 'boolean' },
  { key: 'subqueryNewlineAfterParen', kind: 'boolean' },
  { key: 'subqueryCloseParenOnOwnLine', kind: 'boolean' },
  { key: 'blankLineBetweenStatements', kind: 'boolean' },
];
