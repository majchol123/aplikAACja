import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, redirect } from './redirect.ts';

const location = (url: string) => redirect(new Request(url)).headers.get('Location');

describe('www → app origin', () => {
  it('redirects permanently and keeps the path and the query', () => {
    const res = redirect(new Request('https://www.aplikaacja.one.pl/pomoc?a=1&b=%C4%85#generator'));
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://aplikaacja.one.pl/pomoc?a=1&b=%C4%85');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains',
    );
  });

  it('keeps the root and a trailing slash', () => {
    expect(location('https://www.aplikaacja.one.pl')).toBe('https://aplikaacja.one.pl/');
    expect(location('http://www.aplikaacja.one.pl/o-aplikacji/')).toBe(
      'https://aplikaacja.one.pl/o-aplikacji/',
    );
  });

  it('never leaves the app origin', () => {
    for (const path of [
      '//evil.example/x',
      '/\\evil.example',
      '/@evil.example',
      '/%2F%2Fevil.example',
    ]) {
      const target = new URL(location(`https://www.aplikaacja.one.pl${path}`) ?? '');
      expect(target.origin).toBe(APP_ORIGIN);
    }
  });
});
