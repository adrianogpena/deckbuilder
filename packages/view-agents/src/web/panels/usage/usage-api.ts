import { request } from '@kedalion/ui';

export interface Totals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  usd: number;
}
export interface Row extends Totals {
  key: string;
}
export interface Summary {
  now: number;
  today: Totals;
  week: Totals;
  month: Totals;
  days: Array<{ day: string; usd: number }>;
  burnPerHour: number;
  bySession: Row[];
  byProject: Row[];
  byModel: Row[];
}
export interface Limits {
  daily?: number;
  monthly?: number;
}
export interface Budgets {
  global: Limits;
  projects: Record<string, Limits>;
}
export interface UsageData {
  summary: Summary;
  accounts: Array<{ id: string; label: string; summary: Summary }>;
  budgets: Budgets;
  spend: { day: number; month: number; projects: Record<string, { day: number; month: number }> };
}

export const loadUsage = () => request<UsageData>('GET', '/api/agents/usage/summary');
export const saveBudgets = (b: Budgets) => request<{ ok: boolean }>('PUT', '/api/agents/usage/budgets', {}, b);
