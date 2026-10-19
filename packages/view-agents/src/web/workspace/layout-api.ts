import { request } from '@deckbuilderkit/ui';

/** The saved workspace layout of a project (serialized `Layout`), or null when none is saved or the file is bad. */
export const getLayout = (project: string) => request<{ layout: unknown | null }>('GET', '/api/agents/layout', { project });

export const putLayout = (project: string, layout: unknown) => request<{ ok: boolean }>('PUT', '/api/agents/layout', { project }, { layout });
