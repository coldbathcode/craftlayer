/**
 * Detects the server pulling the bot back over and over ("rubber-banding").
 *
 * Mineflayer's client physics occasionally disagrees with the server about a
 * collision (seen when jumping against leaves in a tree canopy). The server then
 * corrects the bot every tick and pathfinding never progresses. The body uses
 * this guard to notice the loop, let go of the controls and retry or give up.
 */
export interface CorrectionGuardOptions {
  /** Corrections within the window that count as a loop. */
  threshold: number;
  /** Sliding window in milliseconds. */
  windowMs: number;
}

export const defaultCorrectionGuard: CorrectionGuardOptions = {
  threshold: 15,
  windowMs: 1500,
};

export class CorrectionGuard {
  readonly #times: number[] = [];
  readonly #options: CorrectionGuardOptions;
  #total = 0;
  constructor(options: CorrectionGuardOptions = defaultCorrectionGuard) {
    if (options.threshold < 2 || options.windowMs <= 0)
      throw new RangeError("CORRECTION_GUARD_OPTIONS");
    this.#options = options;
  }
  record(now: number): void {
    this.#total++;
    this.#times.push(now);
    this.#trim(now);
  }
  looping(now: number): boolean {
    this.#trim(now);
    return this.#times.length >= this.#options.threshold;
  }
  reset(): void {
    this.#times.length = 0;
  }
  get total(): number {
    return this.#total;
  }
  #trim(now: number): void {
    const oldest = now - this.#options.windowMs;
    while (this.#times.length && (this.#times[0] ?? 0) < oldest)
      this.#times.shift();
  }
}
