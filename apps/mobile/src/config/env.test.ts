import { resolveApiUrl } from './env';

describe('resolveApiUrl', () => {
  it('prefers an explicit URL and trims trailing slashes', () => {
    expect(resolveApiUrl('https://api.example.com/', '10.0.0.2:8081', true)).toBe('https://api.example.com');
  });
  it('derives the dev backend from the Metro host in development', () => {
    expect(resolveApiUrl(undefined, '192.168.1.20:8081', true)).toBe('http://192.168.1.20:4000');
    expect(resolveApiUrl('', 'my-laptop.local:8081', true)).toBe('http://my-laptop.local:4000');
  });
  it('never guesses in production builds', () => {
    expect(resolveApiUrl(undefined, '192.168.1.20:8081', false)).toBeNull();
  });
  it('ignores malformed explicit values', () => {
    expect(resolveApiUrl('localhost:4000', null, false)).toBeNull();
  });
});
