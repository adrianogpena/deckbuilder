import { describe, expect, test } from 'bun:test';
import { isMachineDown, parseDocker, parsePinned, parsePodman, sortPinned } from './model';

const podman = JSON.stringify([
  { Id: 'abcdef1234567890', Names: ['web'], Image: 'nginx', State: 'running', Status: 'Up 2 hours', Created: 1700000000 },
  { Id: '1234567890abcdef', Names: [], Image: 'redis', State: 'exited', Status: 'Exited (0)', Created: 1700000100 },
]);

const docker = [
  '{"ID":"aaa111","Names":"db","Image":"postgres","State":"running","Status":"Up 1 hour","CreatedAt":"2026-01-02 10:00:00 +0000 UTC"}',
  '',
  '{"ID":"bbb2223334445","Names":"api","Image":"api:1","State":"exited","Status":"Exited (1)","CreatedAt":"bad"}',
].join('\n');

describe('containers model', () => {
  test('parsePodman', () => {
    const list = parsePodman(podman);
    expect(list[0]).toEqual({ name: 'web', image: 'nginx', state: 'running', status: 'Up 2 hours', created: 1700000000000 });
    expect(list[1]?.name).toBe('1234567890ab');
    expect(parsePodman('nope')).toEqual([]);
  });

  test('parseDocker', () => {
    const list = parseDocker(docker);
    expect(list.map((c) => c.name)).toEqual(['db', 'api']);
    expect(list[0]?.created).toBeGreaterThan(0);
    expect(list[1]?.created).toBe(0);
  });

  test('isMachineDown', () => {
    expect(isMachineDown('Cannot connect to Podman. Please verify')).toBe(true);
    expect(isMachineDown('unable to connect to Podman socket: x')).toBe(true);
    expect(isMachineDown('other')).toBe(false);
  });

  test('sortPinned', () => {
    const list = parsePodman(podman);
    const sorted = sortPinned(list, parsePinned('web\n\n'));
    expect(sorted[0]?.name).toBe('web');
    expect(sorted[0]?.pinned).toBe(true);
    expect(sortPinned(list, ['1234567890ab'])[0]?.name).toBe('1234567890ab');
  });
});
