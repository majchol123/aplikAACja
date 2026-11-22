import type { MotorSettings } from './device.ts';

/**
 * Decides which pointer gestures activate a tile (PLAN §2.4 motor settings). Pure: the
 * client feeds it pointer events with the tile under the pointer and a timestamp.
 *  - release mode: activates on lift over the same tile, after at least minHoldMs;
 *  - press mode: activates on touch;
 *  - a second finger cancels the gesture and nothing activates until all fingers lift
 *    (palm, whole-hand touches);
 *  - an activation sooner than globalGuardMs after the previous one is dropped, and the same
 *    tile again sooner than sameTileGuardMs (tremor, bouncing fingers).
 */
export class TapFilter {
  private readonly down_ = new Set<number>();
  private active: { pointerId: number; target: string; since: number } | null = null;
  private blocked = false;
  private last: { target: string; at: number } | null = null;

  constructor(private settings: MotorSettings) {}

  configure(settings: MotorSettings): void {
    this.settings = settings;
  }

  /** Returns the activated target, if any. */
  down(pointerId: number, target: string | null, at: number): string | null {
    this.down_.add(pointerId);
    if (this.down_.size > 1) {
      this.active = null;
      this.blocked = true;
      return null;
    }
    if (this.blocked || target === null) return null;
    if (this.settings.activateOn === 'press') return this.fire(target, at);
    this.active = { pointerId, target, since: at };
    return null;
  }

  up(pointerId: number, target: string | null, at: number): string | null {
    this.down_.delete(pointerId);
    if (this.down_.size === 0) this.blocked = false;
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return null;
    this.active = null;
    if (target !== active.target || at - active.since < this.settings.minHoldMs) return null;
    return this.fire(target, at);
  }

  cancel(pointerId: number): void {
    this.down_.delete(pointerId);
    if (this.down_.size === 0) this.blocked = false;
    if (this.active?.pointerId === pointerId) this.active = null;
  }

  private fire(target: string, at: number): string | null {
    if (this.last) {
      const since = at - this.last.at;
      if (since < this.settings.globalGuardMs) return null;
      if (target === this.last.target && since < this.settings.sameTileGuardMs) return null;
    }
    this.last = { target, at };
    return target;
  }
}
