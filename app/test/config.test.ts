import { describe, expect, it } from 'vitest';
import wranglerText from '../wrangler.jsonc?raw';
import { parseJsonc } from './jsonc.ts';

interface WorkerConfig {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: { pattern: string; custom_domain?: boolean }[];
  vars?: Record<string, string>;
  env?: Record<string, WorkerConfig>;
}

const config = parseJsonc(wranglerText) as WorkerConfig;

describe('wrangler.jsonc', () => {
  it('never enables the dev login', () => {
    expect(wranglerText).not.toMatch(/DEV_AUTH/);
  });

  it('keeps every Worker off workers.dev and preview URLs', () => {
    for (const cfg of [config, ...Object.values(config.env ?? {})]) {
      expect(cfg.workers_dev, cfg.name).toBe(false);
      expect(cfg.preview_urls, cfg.name).toBe(false);
    }
  });

  it('maps environments to their custom domains and origins', () => {
    const expected = {
      staging: ['relaacja-staging', 'relaacja-staging.jagiellona.one.pl'],
      production: ['relaacja', 'relaacja.jagiellona.one.pl'],
    } as const;
    for (const [envName, [name, host]] of Object.entries(expected)) {
      const cfg = config.env![envName]!;
      expect(cfg.name).toBe(name);
      expect(cfg.routes).toEqual([{ pattern: host, custom_domain: true }]);
      expect(cfg.vars?.APP_ORIGIN).toBe(`https://${host}`);
      // Vault addresses depend on the jurisdiction: changing it orphans user data.
      expect(cfg.vars?.DO_JURISDICTION).toBe('eu');
    }
    expect(config.routes).toBeUndefined();
  });
});
