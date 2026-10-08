import { join } from 'node:path';
import { homedir } from 'node:os';

/** App data folder `~/.<id>`: outside the install folder, so data survives reinstalls and updates. */
export function appHome(id: string): string {
  return join(homedir(), `.${id}`);
}
