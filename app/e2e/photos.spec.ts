import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  mockSpeech,
} from './support.ts';

failOnConsoleErrors();

test.beforeEach(async ({ page }) => {
  await mockArasaac(page, { withStarter: true });
  await mockSpeech(page);
});

const dialog = (page: Page) => page.getByRole('dialog');
const MEDIA_SRC = /^\/api\/media\/[a-z2-7]{26}$/;
const GPS = 'GPSLatitude=52.2297N';

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

/**
 * A 12 MP phone-camera JPEG (4032 × 3024, megabytes): left half red, right half blue,
 * noise in the top band (or all over: as detailed as a photo can get), and an EXIF segment
 * carrying a GPS position spliced in after the start-of-image marker.
 */
async function cameraJpeg(page: Page, { noisy = false } = {}): Promise<Buffer> {
  const dataUrl = await page.evaluate((noisy) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4032;
    canvas.height = 3024;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 2016, 3024);
    g.fillStyle = '#0000ff';
    g.fillRect(2016, 0, 2016, 3024);
    const band = g.createImageData(4032, noisy ? 3024 : 600);
    for (let i = 0; i < band.data.length; i++) {
      band.data[i] = i % 4 === 3 ? 255 : (i * 2654435761) >>> 24;
    }
    g.putImageData(band, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.95);
  }, noisy);
  const jpeg = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  // Exif\0\0 + big-endian TIFF header with an empty IFD0, then the GPS text.
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0', 'latin1'),
    Buffer.from(GPS, 'latin1'),
  ]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

async function startEditing(page: Page, name: string) {
  await freshLogin(page, name);
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await holdEditLock(page);
  await expect(page.getByRole('heading', { name: 'Tryb edycji' })).toBeVisible();
}

async function pickPhoto(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await dialog(page).getByRole('button', { name: 'Wybierz zdjęcie' }).click();
  await (await chooser).setFiles(file);
}

/** The stored picture, as the app fetches it. */
async function stored(page: Page, src: string) {
  return page.evaluate(async (url) => {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    // 40 % from the left: red in the centred square, blue once moved to the right edge.
    const [r, , b] = g.getImageData(Math.round(bitmap.width * 0.4), bitmap.height / 2, 1, 1).data;
    return {
      type: res.headers.get('Content-Type'),
      cache: res.headers.get('Cache-Control'),
      text: Array.from(bytes, (c) => String.fromCharCode(c)).join(''),
      width: bitmap.width,
      height: bitmap.height,
      sample: { r, b },
    };
  }, src);
}

test('a photo is cropped, stored without its GPS position, used, found and deleted', async ({
  page,
}) => {
  await startEditing(page, 'Zdjecia');
  const original = await cameraJpeg(page);
  expect(original.includes(GPS)).toBe(true);
  expect(original.length).toBeGreaterThan(2 * 1024 * 1024);

  await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 2, kolumna 4' }).click();
  await dialog(page).getByLabel('Etykieta').fill('Jabłko z ogrodu');
  await pickPhoto(page, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: original });

  await expect(dialog(page).getByRole('heading', { name: 'Zdjęcie na kafelek' })).toBeVisible();
  await expect(dialog(page).getByLabel('Nazwa zdjęcia')).toHaveValue('Jabłko z ogrodu');
  await axe(page);
  // The centred square shows both halves; moving it to the right edge shows only blue.
  const crop = page.getByTestId('photo-crop');
  await crop.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await dialog(page).getByRole('button', { name: 'Użyj zdjęcia' }).click();

  await expect(dialog(page).getByRole('heading', { name: 'Nowy kafelek' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog(page)).toHaveCount(0);

  const img = page.getByRole('button', { name: 'Zmień kafelek: Jabłko z ogrodu' }).locator('img');
  const src = (await img.getAttribute('src'))!;
  expect(src).toMatch(MEDIA_SRC);
  const photo = await stored(page, src);
  expect(photo).toMatchObject({
    type: 'image/webp',
    cache: 'private, max-age=31536000, immutable',
    width: 512,
    height: 512,
  });
  expect(photo.text).not.toContain(GPS);
  expect(photo.text).not.toContain('Exif');
  expect(photo.text.length).toBeLessThanOrEqual(200 * 1024);
  // 3024 px square out of 4032 × 3024, moved to the right edge: mostly the blue half.
  expect(photo.sample.b).toBeGreaterThan(200);
  expect(photo.sample.r).toBeLessThan(60);

  // Stored on the server; shown in communication mode after a reload.
  await page.reload();
  const tile = page.getByRole('button', { name: 'Jabłko z ogrodu', exact: true });
  await expect(tile.locator('img')).toHaveAttribute('src', src);

  // Found by its name among the symbols, first and starred (it was chosen for this word).
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 2, kolumna 5' }).click();
  await dialog(page).getByLabel('Etykieta').fill('jablk');
  const results = dialog(page).getByTestId('symbol-results').getByRole('button');
  await expect(results.first()).toHaveAccessibleName(
    'Jabłko z ogrodu (moje zdjęcie), ulubiony wariant',
  );
  await expect(results.nth(1)).toHaveAccessibleName(/^jabłko \(ARASAAC, nr 2462\)$/);
  await dialog(page).getByRole('button', { name: 'Anuluj' }).click();

  // Settings: where it is used; deleting leaves the tile with its label only.
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  const panel = page.getByTestId('photos-panel');
  await expect(panel.getByTestId('photos-usage')).toContainText('1 zdjęcie z 2000');
  await expect(panel).toContainText('Na 1 kafelku');
  await axe(page);
  await panel.getByRole('button', { name: 'Zmień nazwę: Jabłko z ogrodu' }).click();
  await panel.getByLabel('Nazwa zdjęcia').fill('Jabłka babci');
  await panel.getByRole('button', { name: 'Zapisz nazwę' }).click();
  await panel.getByRole('button', { name: 'Usuń zdjęcie: Jabłka babci' }).click();
  await expect(dialog(page)).toContainText('Zdjęcie zniknie z 1 kafelka');
  await dialog(page).getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(panel.getByTestId('photos-usage')).toContainText('0 zdjęć z 2000');
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await expect(
    page.getByRole('button', { name: 'Zmień kafelek: Jabłko z ogrodu' }).locator('img'),
  ).toHaveCount(0);
});

test('without WebP encoding (Safari) the photo is stored as JPEG; non-images are refused', async ({
  page,
}) => {
  // Safari's canvas cannot encode WebP and silently returns PNG instead.
  await page.addInitScript(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      toBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
    };
  });
  await startEditing(page, 'Safari');
  await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 2, kolumna 4' }).click();
  await dialog(page).getByLabel('Etykieta').fill('Dom');

  await pickPhoto(page, {
    name: 'notatka.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('to nie jest zdjęcie'),
  });
  await expect(dialog(page).getByRole('alert')).toContainText('Nie udało się otworzyć');
  await dialog(page).getByRole('button', { name: 'Wróć' }).click();

  await pickPhoto(page, {
    name: 'IMG_0002.jpg',
    mimeType: 'image/jpeg',
    buffer: await cameraJpeg(page, { noisy: true }),
  });
  await dialog(page).getByRole('button', { name: 'Użyj zdjęcia' }).click();
  await dialog(page).getByRole('button', { name: 'Zapisz' }).click();
  const src = (await page
    .getByRole('button', { name: 'Zmień kafelek: Dom' })
    .locator('img')
    .getAttribute('src'))!;
  const photo = await stored(page, src);
  // Pure noise does not fit 200 KB at 512 px even at low quality: fewer pixels then.
  expect(photo.type).toBe('image/jpeg');
  expect(photo.width).toBe(photo.height);
  expect(photo.width).toBeLessThanOrEqual(512);
  expect(photo.text.length).toBeLessThanOrEqual(200 * 1024);
  expect(photo.text).not.toContain(GPS);
});
