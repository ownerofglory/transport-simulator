/**
 * Tracks disposables (geometries, materials, textures, render targets, controls,
 * layers, event bindings wrapped as `{ dispose }`) so an owner can release every
 * resource it created in one call.
 *
 * Each system and layer gets its own scope, giving every Three.js resource a
 * single explicit owner and a deterministic disposal path.
 */
export interface Disposable {
  dispose(): void;
}

export class ResourceScope implements Disposable {
  private readonly disposables = new Set<Disposable>();
  private disposed = false;

  /** Registers a disposable and returns it for convenient inline use. */
  track<T extends Disposable>(value: T): T {
    if (this.disposed) {
      // A scope that already disposed must not adopt new resources — that would
      // silently leak them. Callers racing async loads should check the scope.
      value.dispose();
      return value;
    }
    this.disposables.add(value);
    return value;
  }

  /** Stops tracking a value without disposing it (ownership handed elsewhere). */
  release(value: Disposable): void {
    this.disposables.delete(value);
  }

  /** True once {@link dispose} has run; async loaders should bail if set. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    for (const value of this.disposables) {
      value.dispose();
    }
    this.disposables.clear();
  }
}
