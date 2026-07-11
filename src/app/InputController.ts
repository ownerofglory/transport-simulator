/** Semantic input events emitted from raw keyboard/touch/pointer handling. */
export type InputControllerCallbacks = {
  setThrottle: (held: boolean) => void;
  setBrake: (held: boolean) => void;
  setLook: (leftHeld: boolean, rightHeld: boolean) => void;
  zoom: (delta: number) => void;
  togglePhotoMode: () => void;
  exitPhotoMode: () => void;
};

/**
 * Translates raw keyboard, touch-look, pinch-zoom, and mouse-wheel input into
 * semantic callbacks. Owns its gesture state and all DOM listeners; dispose()
 * removes every listener so the controller can be torn down cleanly.
 */
export class InputController {
  private static readonly TOUCH_LOOK_DEADZONE_PX = 24;
  private static readonly TOUCH_LOOK_MAX_VERTICAL_DRIFT_PX = 64;
  private static readonly WHEEL_ZOOM_SENSITIVITY = 0.0012;
  private static readonly PINCH_ZOOM_SENSITIVITY = 0.004;

  // Combined interior-look state shared by keyboard arrows and touch swipe.
  private lookLeft = false;
  private lookRight = false;

  private activeLookTouchId: number | null = null;
  private touchLookStartX = 0;
  private touchLookStartY = 0;
  private pinchDistancePx: number | null = null;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.callbacks.exitPhotoMode();
      return;
    }
    if ((event.key === 'p' || event.key === 'P') && !event.repeat) {
      event.preventDefault();
      this.callbacks.togglePhotoMode();
      return;
    }
    if (event.repeat) return;
    this.applyKey(event.key, true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.applyKey(event.key, false);
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length === 2) {
      this.clearLookTouch();
      this.pinchDistancePx = this.touchDistance(event.touches[0], event.touches[1]);
      return;
    }

    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (!touch) return;

    this.activeLookTouchId = touch.identifier;
    this.touchLookStartX = touch.clientX;
    this.touchLookStartY = touch.clientY;
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length === 2) {
      const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]];
      if (!firstTouch || !secondTouch) return;

      const distancePx = this.touchDistance(firstTouch, secondTouch);
      if (this.pinchDistancePx != null) {
        const deltaPx = distancePx - this.pinchDistancePx;
        this.callbacks.zoom(deltaPx * InputController.PINCH_ZOOM_SENSITIVITY);
      }
      this.pinchDistancePx = distancePx;
      this.clearLookTouch();
      event.preventDefault();
      return;
    }

    if (this.activeLookTouchId == null) return;

    const touch = Array.from(event.touches).find((entry) => entry.identifier === this.activeLookTouchId);
    if (!touch) return;

    const deltaX = touch.clientX - this.touchLookStartX;
    const deltaY = touch.clientY - this.touchLookStartY;

    if (Math.abs(deltaY) > InputController.TOUCH_LOOK_MAX_VERTICAL_DRIFT_PX) {
      this.clearLookTouch();
      return;
    }

    const shouldLookLeft = deltaX > InputController.TOUCH_LOOK_DEADZONE_PX;
    const shouldLookRight = deltaX < -InputController.TOUCH_LOOK_DEADZONE_PX;

    if (this.lookLeft !== shouldLookLeft || this.lookRight !== shouldLookRight) {
      this.lookLeft = shouldLookLeft;
      this.lookRight = shouldLookRight;
      this.callbacks.setLook(this.lookLeft, this.lookRight);
    }
  };

  private readonly onTouchRelease = (event: TouchEvent): void => {
    if (event.touches.length < 2) this.pinchDistancePx = null;
    if (this.activeLookTouchId == null) return;

    const changed = Array.from(event.changedTouches).some((touch) => touch.identifier === this.activeLookTouchId);
    if (!changed) return;

    this.clearLookTouch();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.callbacks.zoom(-event.deltaY * InputController.WHEEL_ZOOM_SENSITIVITY);
  };

  constructor(
    private readonly appEl: HTMLElement,
    private readonly callbacks: InputControllerCallbacks
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.appEl.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.appEl.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.appEl.addEventListener('touchend', this.onTouchRelease, { passive: true });
    this.appEl.addEventListener('touchcancel', this.onTouchRelease, { passive: true });
    this.appEl.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Removes every DOM listener registered by this controller. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.appEl.removeEventListener('touchstart', this.onTouchStart);
    this.appEl.removeEventListener('touchmove', this.onTouchMove);
    this.appEl.removeEventListener('touchend', this.onTouchRelease);
    this.appEl.removeEventListener('touchcancel', this.onTouchRelease);
    this.appEl.removeEventListener('wheel', this.onWheel);
  }

  private applyKey(key: string, held: boolean): void {
    if (key === 'w' || key === 'ArrowUp') this.callbacks.setThrottle(held);
    else if (key === 's' || key === 'ArrowDown') this.callbacks.setBrake(held);
    else if (key === 'ArrowLeft') this.setLook(held, this.lookRight);
    else if (key === 'ArrowRight') this.setLook(this.lookLeft, held);
  }

  private setLook(leftHeld: boolean, rightHeld: boolean): void {
    this.lookLeft = leftHeld;
    this.lookRight = rightHeld;
    this.callbacks.setLook(this.lookLeft, this.lookRight);
  }

  /** Ends any active look gesture and clears the look state if it was set. */
  private clearLookTouch(): void {
    this.activeLookTouchId = null;
    if (!this.lookLeft && !this.lookRight) return;
    this.lookLeft = false;
    this.lookRight = false;
    this.callbacks.setLook(false, false);
  }

  private touchDistance(firstTouch: Touch, secondTouch: Touch): number {
    return Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY
    );
  }
}
