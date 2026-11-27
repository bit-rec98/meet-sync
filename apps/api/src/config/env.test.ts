import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ nodeEnv: 'development', port: 3000 });
  });

  it('reads valid values', () => {
    expect(loadConfig({ NODE_ENV: 'production', API_PORT: '8080' })).toEqual({
      nodeEnv: 'production',
      port: 8080,
    });
  });

  it('rejects invalid values and names the variable without echoing its value', () => {
    expect(() => loadConfig({ API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ API_PORT: 'not-a-port' })).not.toThrow(/not-a-port/);
  });
});
