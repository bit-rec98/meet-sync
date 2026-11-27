import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './RouteGuards';

describe('safeReturnPath', () => {
  it('returns the page the visitor wanted when it is a path of this site', () => {
    expect(safeReturnPath({ from: { pathname: '/meetings/42' } })).toBe('/meetings/42');
    expect(safeReturnPath({ from: { pathname: '/' } })).toBe('/');
  });

  it('falls back to the start page without a usable origin', () => {
    for (const state of [
      null,
      undefined,
      {},
      { from: null },
      { from: {} },
      { from: 'string' },
      'x',
      42,
    ]) {
      expect(safeReturnPath(state), JSON.stringify(state)).toBe('/');
    }
  });

  it('never redirects off the site', () => {
    for (const pathname of [
      '//evil.example',
      '//evil.example/path',
      'https://evil.example',
      'http://evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      42,
      null,
    ]) {
      expect(safeReturnPath({ from: { pathname } }), String(pathname)).toBe('/');
    }
  });
});
