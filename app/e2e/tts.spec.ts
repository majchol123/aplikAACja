import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { failOnConsoleErrors, freshLogin, mockSpeech } from './support.ts';

failOnConsoleErrors();

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

test('downloading, selecting and removing an offline Piper voice persists on the device', async ({
  page,
}) => {
  const phonemizeWasm = Buffer.from('fake-wasm');
  const phonemizeData = Buffer.from('fake-data');
  const ortMjs = Buffer.from('export default function() {}');
  const ortWasm = Buffer.from('fake-ort-wasm');
  const part0 = Buffer.from('onnx-part-0-');
  const part1 = Buffer.from('onnx-part-1');
  const fullOnnx = Buffer.concat([part0, part1]);
  const voiceConfig = {
    audio: { sample_rate: 22050 },
    espeak: { voice: 'pl' },
    inference: { noise_scale: 0.5, length_scale: 1, noise_w: 0.333 },
    phoneme_id_map: { '^': [1], _: [0], $: [2] },
    speaker_id_map: {},
  };
  const manifest = {
    v: 1,
    runtime: {
      hash: '1234abcd',
      ortMjs: 'runtime/1234abcd/ort-wasm-simd-threaded.mjs',
      ortWasm: 'runtime/1234abcd/ort-wasm-simd-threaded.wasm',
      phonemizeWasm: 'runtime/1234abcd/piper_phonemize.wasm',
      phonemizeData: 'runtime/1234abcd/piper_phonemize.data',
      phonemizeWasmSha256: sha256(phonemizeWasm),
      phonemizeDataSha256: sha256(phonemizeData),
      totalBytes:
        phonemizeWasm.byteLength +
        phonemizeData.byteLength +
        ortMjs.byteLength +
        ortWasm.byteLength,
    },
    voices: [
      {
        id: 'pl_PL-gosia-medium',
        name: 'Gosia',
        gender: 'female',
        quality: 'medium',
        sampleRate: 22050,
        license: 'CC0',
        sourceName: 'rhasspy/piper-voices',
        bytes: fullOnnx.byteLength,
        sha256: sha256(fullOnnx),
        config: 'voices/pl_PL-gosia-medium.aaaaaaaa.onnx.json',
        parts: [
          'voices/pl_PL-gosia-medium.aaaaaaaa.onnx.part00',
          'voices/pl_PL-gosia-medium.aaaaaaaa.onnx.part01',
        ],
      },
    ],
  };

  await page.route('**/tts/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/tts/manifest.json') return route.fulfill({ json: manifest });
    if (path === `/tts/${manifest.runtime.phonemizeWasm}`) {
      return route.fulfill({ body: phonemizeWasm, contentType: 'application/wasm' });
    }
    if (path === `/tts/${manifest.runtime.phonemizeData}`) {
      return route.fulfill({ body: phonemizeData, contentType: 'application/octet-stream' });
    }
    if (path === `/tts/${manifest.runtime.ortMjs}`) {
      return route.fulfill({ body: ortMjs, contentType: 'text/javascript' });
    }
    if (path === `/tts/${manifest.runtime.ortWasm}`) {
      return route.fulfill({ body: ortWasm, contentType: 'application/wasm' });
    }
    if (path === `/tts/${manifest.voices[0]!.config}`) {
      return route.fulfill({ json: voiceConfig });
    }
    if (path === `/tts/${manifest.voices[0]!.parts[0]}`) {
      return route.fulfill({ body: part0, contentType: 'application/octet-stream' });
    }
    if (path === `/tts/${manifest.voices[0]!.parts[1]}`) {
      return route.fulfill({ body: part1, contentType: 'application/octet-stream' });
    }
    return route.fulfill({ status: 404 });
  });

  await mockSpeech(page);
  await freshLogin(page, 'Piper TTS');
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();

  await page.getByRole('button', { name: 'Pobierz ulepszony głos (offline)' }).click();
  await expect(page.getByText('Ulepszone głosy offline')).toBeVisible();
  await expect(page.getByText('Gosia')).toBeVisible();

  await page.getByRole('button', { name: 'Pobierz', exact: true }).click();
  await expect(page.getByText('Aktywny dla „Kobieta”')).toBeVisible();

  const voiceSelect = page.getByLabel(/Głos syntezatora dla/);
  await expect(voiceSelect).toHaveValue('piper:pl_PL-gosia-medium');

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Installed voice and selection survive a reload without re-fetching /tts/manifest.json.
  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(page.getByText('Aktywny dla „Kobieta”')).toBeVisible();
  await expect(page.getByLabel(/Głos syntezatora dla/)).toHaveValue('piper:pl_PL-gosia-medium');

  await page.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(page.getByText('Ulepszone głosy offline')).toHaveCount(0);
  await expect(page.getByLabel(/Głos syntezatora dla/)).toHaveValue('');
});
