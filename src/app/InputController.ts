import { isTypingTarget } from './typingTarget';

export type InputCallbacks = {
  onThrottle(held: boolean): void;
  onBrake(held: boolean): void;
  onLook(left: boolean, right: boolean): void;
  onZoom(delta: number): void;
  onCameraCycle(direction: CameraCycleDirection): void;
  onPhotoToggle(): void;
  onPhotoExit(): void;
};

export type CameraCycleDirection = 'next' | 'previous';

const CAMERA_SWIPE_DISTANCE = 72;

/** Recognizes deliberate vertical view changes while leaving horizontal look intact. */
export function cameraSwipeDirection(
  deltaX: number,
  deltaY: number,
  isMobile: boolean
): CameraCycleDirection | undefined {
  if (!isMobile || Math.abs(deltaY) < CAMERA_SWIPE_DISTANCE || Math.abs(deltaY) <= Math.abs(deltaX)) return undefined;
  return deltaY < 0 ? 'next' : 'previous';
}

/** Maps desktop camera shortcuts without intercepting them in the mobile layout. */
export function cameraKeyDirection(key: string, isMobile: boolean): CameraCycleDirection | undefined {
  if (isMobile) return undefined;
  if (key === 'ArrowUp') return 'next';
  if (key === 'ArrowDown') return 'previous';
  return undefined;
}

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
    // Never eat keystrokes destined for a text field: 'p', 'w' and 's' are just
    // letters while the user is typing a station name.
    if (isTypingTarget(e.target)) return;
    if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
      e.preventDefault();
      this.callbacks.onPhotoToggle();
    }
    const cameraDirection = cameraKeyDirection(e.key, window.matchMedia('(max-width: 760px)').matches);
    if (cameraDirection) {
      e.preventDefault();
      if (!e.repeat) this.callbacks.onCameraCycle(cameraDirection);
      return;
    }
    if (e.repeat) return;
    if (e.key === 'w') this.callbacks.onThrottle(true);
    if (e.key === 's') this.callbacks.onBrake(true);
    if (e.key === 'ArrowLeft') this.callbacks.onLook(true, false);
    if (e.key === 'ArrowRight') this.callbacks.onLook(false, true);
  };

  private keyUp = (e: KeyboardEvent): void => {
    if (e.key === 'w') this.callbacks.onThrottle(false);
    if (e.key === 's') this.callbacks.onBrake(false);
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

  private touchEnd = (e: TouchEvent): void => {
    const touch = Array.from(e.changedTouches).find((entry) => entry.identifier === this.touchId);
    if (e.type === 'touchend' && touch && this.pinchDistance == null) {
      const direction = cameraSwipeDirection(
        touch.clientX - this.startX,
        touch.clientY - this.startY,
        window.matchMedia('(max-width: 760px)').matches
      );
      if (direction) this.callbacks.onCameraCycle(direction);
    }
    this.touchId = null;
    this.pinchDistance = null;
    this.callbacks.onLook(false, false);
  };
}

const distance = (a: Touch, b: Touch): number => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
