import { describe, expect, test } from 'bun:test';
import { classifyStderr } from './kube-errors';

describe('classifyStderr', () => {
  const code = (s: string) => classifyStderr(s).code;
  test('known failures', () => {
    expect(code("'az' is not recognized as an internal or external command")).toBe('missingBinary');
    expect(code('AADSTS70043: token expired, run az login')).toBe('azureLogin');
    expect(code('error: You must be logged in to the server (Unauthorized)')).toBe('credentialsRejected');
    expect(code('pods is forbidden: User cannot list resource')).toBe('forbidden');
    expect(code('Error from server (NotFound): pods "x" not found')).toBe('notfound');
    expect(code('Unable to connect to the server: dial tcp 1.2.3.4:443')).toBe('unreachable');
    expect(code('operation timed out')).toBe('timeout');
  });
  test('azure wins over unauthorized', () => {
    expect(code('Unauthorized: please az login')).toBe('azureLogin');
  });
  test('raw keeps the first line', () => {
    expect(classifyStderr('\nerror: boom\nmore')).toEqual({ code: 'raw', message: 'boom' });
  });
});
