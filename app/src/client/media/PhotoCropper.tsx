import { BOARD_LIMITS, MEDIA_LIMITS } from '@relaacja/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ui } from '../edit/ui.ts';
import {
  clampCrop,
  decodePhoto,
  encodePhoto,
  fullCrop,
  maxZoom,
  PhotoError,
  renderCrop,
  rotateCrop,
  rotateQuarter,
  zoomCrop,
  type Crop,
} from './encode.ts';

/** Preview edge in CSS pixels (the canvas has device pixels). */
const VIEW = 288;

interface Loaded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Square crop of a picked photo (PLAN §2.2): drag to move, pinch / wheel / slider / + − to
 * zoom, arrow keys to move. The result is drawn on a canvas and re-encoded, so nothing of
 * the original file (EXIF with GPS) is uploaded.
 */
export function PhotoCropper({
  file,
  initialLabel,
  busy,
  problem,
  onBack,
  onUse,
}: {
  file: File;
  initialLabel: string;
  busy: boolean;
  problem: string | null;
  onBack: () => void;
  onUse: (label: string, image: Blob) => void;
}) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [label, setLabel] = useState(initialLabel);
  const [error, setError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [rotating, setRotating] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    decodePhoto(file).then(
      (decoded) => {
        bitmap = decoded;
        if (!alive) return decoded.close();
        setPhoto({ bitmap: decoded, width: decoded.width, height: decoded.height });
        setCrop(fullCrop(decoded.width, decoded.height));
      },
      (err: unknown) => alive && setError(err instanceof PhotoError ? err.message : String(err)),
    );
    return () => {
      alive = false;
      bitmap?.close();
    };
  }, [file]);

  // A replaced picture (turned) and the last one on closing give their memory back.
  useEffect(() => () => photo?.bitmap.close(), [photo]);

  // Preview: the crop drawn on a canvas, re-rendered on every move.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photo || !crop) return;
    const px = Math.round(VIEW * Math.min(window.devicePixelRatio || 1, 3));
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, px, px);
    g.drawImage(photo.bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, px, px);
  }, [photo, crop]);

  const update = (next: (c: Crop, p: Loaded) => Crop) => {
    if (!photo) return;
    setCrop((c) => c && clampCrop(next(c, photo), photo.width, photo.height));
  };
  const zoomOf = (c: Crop, p: Loaded) => Math.min(p.width, p.height) / c.size;
  const zoomBy = (factor: number) =>
    update((c, p) => zoomCrop(c, zoomOf(c, p) * factor, p.width, p.height));
  const moveBy = (dx: number, dy: number) =>
    update((c) => ({ ...c, x: c.x + dx * c.size, y: c.y + dy * c.size }));

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY / 500));
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  });

  async function rotate(): Promise<void> {
    if (!photo || !crop || rotating) return;
    setRotating(true);
    try {
      const turned = await rotateQuarter(photo.bitmap);
      setPhoto({ bitmap: turned, width: turned.width, height: turned.height });
      setCrop(clampCrop(rotateCrop(crop, photo.height), turned.width, turned.height));
    } catch {
      setError('Nie udało się obrócić zdjęcia.');
    } finally {
      setRotating(false);
    }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    const map = pointers.current;
    const last = map.get(e.pointerId);
    if (!last) return;
    const other = [...map.entries()].find(([pid]) => pid !== e.pointerId)?.[1];
    const now = { x: e.clientX, y: e.clientY };
    if (!other) {
      // Dragging the picture right shows more of its left side.
      const view = e.currentTarget.clientWidth || VIEW;
      moveBy(-(now.x - last.x) / view, -(now.y - last.y) / view);
    } else {
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) zoomBy(after / before);
    }
    map.set(e.pointerId, now);
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    pointers.current.delete(e.pointerId);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const step = 0.05;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => moveBy(-step, 0),
      ArrowRight: () => moveBy(step, 0),
      ArrowUp: () => moveBy(0, -step),
      ArrowDown: () => moveBy(0, step),
      '+': () => zoomBy(1.1),
      '=': () => zoomBy(1.1),
      '-': () => zoomBy(1 / 1.1),
      r: () => void rotate(),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  async function use(): Promise<void> {
    const name = label.trim();
    if (!name) return setError('Wpisz nazwę zdjęcia.');
    if (!photo || !crop) return;
    setError(null);
    setEncoding(true);
    try {
      const image = await encodePhoto(renderCrop(photo.bitmap, crop, MEDIA_LIMITS.maxSide));
      onUse(name, image);
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'Nie udało się przygotować zdjęcia.');
    } finally {
      setEncoding(false);
    }
  }

  const zoom = photo && crop ? zoomOf(crop, photo) : 1;
  const message = error ?? problem;

  return (
    <div className="mt-4 grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="space-y-3">
        <div
          ref={areaRef}
          role="group"
          tabIndex={0}
          aria-label="Kadr zdjęcia: przeciągnij, aby przesunąć; strzałki przesuwają, plus i minus powiększają, R obraca"
          aria-describedby={`${id}-hint`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          className="photo-crop relative size-72 cursor-grab overflow-hidden rounded-2xl bg-slate-200 outline-offset-4 focus-visible:outline-4 focus-visible:outline-brand-700 active:cursor-grabbing"
          data-testid="photo-crop"
        >
          <canvas ref={canvasRef} className="size-full" />
          {!photo && !error && (
            <p className="absolute inset-0 grid place-items-center text-slate-600">Wczytywanie…</p>
          )}
        </div>
        <label className={`${ui.field} max-w-72`}>
          Powiększenie
          <input
            type="range"
            min={1}
            max={photo ? maxZoom(photo.width, photo.height) : 1}
            step={0.01}
            value={zoom}
            disabled={!photo}
            onChange={(e) =>
              update((c, p) => zoomCrop(c, Number(e.target.value), p.width, p.height))
            }
            className="mt-2 w-full accent-brand-700"
          />
        </label>
        <button
          type="button"
          className={ui.secondary}
          disabled={!photo || rotating}
          onClick={() => void rotate()}
        >
          Obróć o 90°
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <p id={`${id}-hint`} className="text-slate-700">
          Na kafelku będzie widać to, co w kwadracie: przesuń zdjęcie palcem lub myszą, powiększ
          suwakiem lub dwoma palcami, a jeśli leży bokiem — obróć je. Zapisuje się na Twoim koncie
          jako obrazek o boku do {MEDIA_LIMITS.maxSide} pikseli, bez danych o miejscu i aparacie.
        </p>
        <label className={ui.field}>
          Nazwa zdjęcia
          <input
            value={label}
            maxLength={BOARD_LIMITS.labelMax}
            onChange={(e) => setLabel(e.target.value)}
            className={ui.input}
            autoComplete="off"
          />
          <span className="mt-1 block text-sm font-normal text-slate-600">
            Po niej znajdziesz zdjęcie w wyszukiwarce symboli.
          </span>
        </label>
        {message && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800">
            {message}
          </p>
        )}
        <div className="mt-auto flex flex-wrap justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={onBack}>
            Wróć
          </button>
          <button
            type="button"
            className={ui.primary}
            disabled={!photo || busy || encoding}
            onClick={() => void use()}
          >
            {busy || encoding ? 'Zapisywanie…' : 'Użyj zdjęcia'}
          </button>
        </div>
      </div>
    </div>
  );
}
