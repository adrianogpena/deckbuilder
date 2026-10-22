import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotifications } from '../notifications.ts';
import type { Toast } from './toast.ts';
import { iconBadgeSvg, iconPng } from './icon-png.ts';

const dir = mkdtempSync(join(tmpdir(), 'icon-png-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('the badge draws the icon path in white on the accent colour', () => {
  const svg = iconBadgeSvg('M1 1h2', '#112233');
  expect(svg).toContain('fill="#112233"');
  expect(svg).toContain('stroke="#fff"');
  expect(svg).toContain('<path d="M1 1h2"/>');
});

test('an icon is rendered once to a PNG named by icon and colour', async () => {
  const file = await iconPng({ name: 'home', color: '#AABBCC', dir });
  expect(file).toBe(join(dir, 'home-aabbcc-96.png'));
  const bytes = await Bun.file(file!).bytes();
  expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  const mtime = statSync(file!).mtimeMs;
  expect(await iconPng({ name: 'home', color: '#aabbcc', dir })).toBe(file);
  expect(statSync(file!).mtimeMs).toBe(mtime);
});

test('an unknown icon has no PNG', async () => {
  expect(await iconPng({ name: 'nope', dir })).toBeUndefined();
});

test('notifications resolve the view icon, the click link and do not disturb', async () => {
  const toasts: Toast[] = [];
  let muted = false;
  const n = createNotifications({
    appName: 'App',
    link: () => (path) => `app://open/${path}`,
    dnd: () => muted,
    viewIcons: (id) => (id === 'v' ? 'folder' : undefined),
    iconDir: dir,
    sink: (t) => toasts.push(t),
  });
  await n.for('v')({ body: 'b', path: 'x/y' });
  await n.for('other')({ title: 'T', body: 'c' });
  muted = true;
  await n.for('v')({ body: 'd' });
  expect(toasts).toEqual([
    { title: 'App', body: 'b', launch: 'app://open/x/y', icon: join(dir, 'folder-4f6bed-96.png') },
    { title: 'T', body: 'c', launch: '' },
  ]);
});
