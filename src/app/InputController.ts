export type InputCallbacks = {
  onThrottle(held: boolean): void;
  onBrake(held: boolean): void;
  onLook(left: boolean, right: boolean): void;
  onZoom(delta: number): void;
  onPhotoToggle(): void;
  onPhotoExit(): void;
};

/** Owns keyboard, wheel, and touch gestures without coupling them to React or Three.js. */
export class InputController {
  private touchId: number | null = null;
  private startX = 0;
  private startY = 0;
  private pinchDistance: number | null = null;

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: InputCallbacks
  ) {
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    addEventListener('blur', this.releaseAll);
    target.addEventListener('wheel', this.wheel, { passive: false });
    target.addEventListener('touchstart', this.touchStart, { passive: true });
    target.addEventListener('touchmove', this.touchMove, { passive: false });
    target.addEventListener('touchend', this.touchEnd, { passive: true });
    target.addEventListener('touchcancel', this.touchEnd, { passive: true });
  }

  dispose(): void {
    // Release held controls so a disposed controller cannot leave input latched.
    this.releaseAll();
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    removeEventListener('blur', this.releaseAll);
    this.target.removeEventListener('wheel', this.wheel);
    this.target.removeEventListener('touchstart', this.touchStart);
    this.target.removeEventListener('touchmove', this.touchMove);
    this.target.removeEventListener('touchend', this.touchEnd);
    this.target.removeEventListener('touchcancel', this.touchEnd);
  }

  /** Releases every held control; used on focus loss and disposal. */
  private releaseAll = (): void => {
    this.callbacks.onThrottle(false);
    this.callbacks.onBrake(false);
    this.callbacks.onLook(false, false);
  };

  private keyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.callbacks.onPhotoExit();
    if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
      e.preventDefault();
      this.callbacks.onPhotoToggle();
    }
    if (e.repeat) return;
    if (e.key === 'w' || e.key === 'ArrowUp') this.callbacks.onThrottle(true);
    if (e.key === 's' || e.key === 'ArrowDown') this.callbacks.onBrake(true);
    if (e.key === 'ArrowLeft') this.callbacks.onLook(true, false);
    if (e.key === 'ArrowRight') this.callbacks.onLook(false, true);
  };

  private keyUp = (e: KeyboardEvent): void => {
    if (e.key === 'w' || e.key === 'ArrowUp') this.callbacks.onThrottle(false);
    if (e.key === 's' || e.key === 'ArrowDown') this.callbacks.onBrake(false);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.callbacks.onLook(false, false);
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.callbacks.onZoom(-e.deltaY * 0.0012);
  };

  private touchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      this.pinchDistance = distance(e.touches[0], e.touches[1]);
      this.touchId = null;
      return;
    }
    const touch = e.touches[0];
    if (touch) {
      this.touchId = touch.identifier;
      this.startX = touch.clientX;
      this.startY = touch.clientY;
    }
  };

  private touchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!a || !b) return;
      const next = distance(a, b);
      if (this.pinchDistance != null) this.callbacks.onZoom((next - this.pinchDistance) * 0.004);
      this.pinchDistance = next;
      e.preventDefault();
      return;
    }
    const touch = Array.from(e.touches).find((entry) => entry.identifier === this.touchId);
    if (!touch) return;
    const x = touch.clientX - this.startX;
    const y = touch.clientY - this.startY;
    if (Math.abs(y) > 64) return this.callbacks.onLook(false, false);
    this.callbacks.onLook(x > 24, x < -24);
  };

  private touchEnd = (): void => {
    this.touchId = null;
    this.pinchDistance = null;
    this.callbacks.onLook(false, false);
  };
}

const distance = (a: Touch, b: Touch): number => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
