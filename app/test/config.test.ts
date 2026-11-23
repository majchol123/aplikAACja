import { describe, expect, it } from 'vitest';
import arasaacText from '../../workers/arasaac/wrangler.jsonc?raw';
import extraText from '../../workers/extra/wrangler.jsonc?raw';
import wranglerText from '../wrangler.jsonc?raw';
import { parseJsonc } from './jsonc.ts';

interface WorkerConfig {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  main?: string;
  routes?: { pattern: string; custom_domain?: boolean; zone_name?: string }[];
  vars?: Record<string, string>;
  services?: { binding: string; service: string }[];
  assets?: { directory?: string; binding?: string; run_worker_first?: string[] };
  env?: Record<string, WorkerConfig>;
}

const config = parseJsonc(wranglerText) as WorkerConfig;
const extra = parseJsonc(extraText) as WorkerConfig;
const arasaac = parseJsonc(arasaacText) as WorkerConfig;
const HOSTS = ['aplikaacja.one.pl', 'staging.aplikaacja.one.pl'];

describe('wrangler.jsonc', () => {
  it('never enables the dev login', () => {
    expect(wranglerText).not.toMatch(/DEV_AUTH/);
  });

  it('keeps every Worker off workers.dev and preview URLs', () => {
    for (const cfg of [config, ...Object.values(config.env ?? {}), extra, arasaac]) {
      expect(cfg.workers_dev, cfg.name).toBe(false);
      expect(cfg.preview_urls, cfg.name).toBe(false);
    }
  });

  it('maps environments to their custom domains and origins', () => {
    const expected = {
      staging: ['aplikaacja-staging', 'staging.aplikaacja.one.pl'],
      production: ['aplikaacja', 'aplikaacja.one.pl'],
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

  it('binds the extra set only as a service, behind the gate', () => {
    for (const cfg of [config, config.env!.staging!, config.env!.production!]) {
      expect(cfg.services, cfg.name).toEqual([{ binding: 'EXTRA_SET', service: extra.name }]);
    }
    expect(config.assets?.run_worker_first).toContain('/sym/extra/*');
  });
});

describe('symbol-set Workers', () => {
  it('extra set: private, reachable only through the service binding', () => {
    expect(extra.name).toBe('aplikaacja-extra');
    expect(extra.routes).toBeUndefined();
    expect(extra.env).toBeUndefined();
    expect(extra.assets?.directory).toBe('./dist'); // gitignored
  });

  it('ARASAAC mirror: assets only, routed under /sym/arasaac/ on both app hosts', () => {
    expect(arasaac.name).toBe('aplikaacja-arasaac');
    expect(arasaac.main).toBeUndefined(); // no script → unmetered static requests
    expect(arasaac.routes).toEqual(
      HOSTS.map((host) => ({ pattern: `${host}/sym/arasaac/*`, zone_name: 'aplikaacja.one.pl' })),
    );
  });
});
