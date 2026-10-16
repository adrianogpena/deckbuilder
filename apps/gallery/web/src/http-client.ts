import type { HttpClient } from '@deckbuilderkit/editor';
import type { ExplorerClient } from '@deckbuilderkit/view-explorer/web';
import type { GitClient } from '@deckbuilderkit/view-git/web';
import type { RestClient } from '@deckbuilderkit/view-rest/web';
import { api } from './api';

/** The calls the REST views of `@deckbuilderkit/editor` make, served by the app's api. */
export const httpClient: HttpClient = {
  send: (request, secretRef, signal, env) => api.httpSend(request, secretRef, signal, env),
  environments: () => api.restEnvironments(),
};

/** What the REST view calls: the HTTP client plus saved requests, tabs, history and environments. */
export const restClient: RestClient = {
  ...httpClient,
  requests: () => api.requests(),
  createRequest: (input) => api.createRequest(input),
  updateRequest: (id, input) => api.updateRequest(id, input),
  deleteRequest: (id) => api.deleteRequest(id),
  reorderRequests: (ids) => api.reorderRequests(ids),
  requestAuth: (id) => api.requestAuth(id),
  importRequestsFile: () => api.importRequestsFile(),
  saveCurl: (text) => api.saveCurl(text),
  httpSave: (id) => api.httpSave(id),
  restTabs: () => api.restTabs(),
  saveRestTabs: (file) => api.saveRestTabs(file),
  createRestEnvironment: (input) => api.createRestEnvironment(input),
  updateRestEnvironment: (id, input) => api.updateRestEnvironment(id, input),
  deleteRestEnvironment: (id) => api.deleteRestEnvironment(id),
  restHistory: (q) => api.restHistory(q),
  clearRestHistory: () => api.clearRestHistory(),
};

/** What the Explorer calls: its own routes (the SQL and HTTP clients are passed next to it). */
export const explorerClient: ExplorerClient = api;

/** What the Git view calls. */
export const gitClient: GitClient = {
  projects: () => api.projects(),
  gitRepos: () => api.gitRepos(),
  gitStatus: (root) => api.gitStatus(root),
  gitFile: (root, path, from, commit) => api.gitFile(root, path, from, commit),
  gitLog: (root, skip, limit) => api.gitLog(root, skip, limit),
  gitCommit: (root, commit) => api.gitCommit(root, commit),
  gitDiff: (root, path, staged, commit) => api.gitDiff(root, path, staged, commit),
  fsRead: (root, path) => api.fsRead(root, path),
};
