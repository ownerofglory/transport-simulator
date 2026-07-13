/**
 * A keyed lookup of builder strategies, replacing large `if (kind === …)`
 * chains. Register a builder per key; resolve it by key at build time. New
 * variants register without editing existing branch logic.
 */
export class BuilderRegistry<K, B> {
  private readonly builders = new Map<K, B>();

  register(key: K, builder: B): this {
    this.builders.set(key, builder);
    return this;
  }

  has(key: K): boolean {
    return this.builders.has(key);
  }

  /** Returns the builder for `key`, or undefined if none is registered. */
  resolveOptional(key: K): B | undefined {
    return this.builders.get(key);
  }

  /** Returns the builder for `key`, throwing if none is registered. */
  resolve(key: K): B {
    const builder = this.builders.get(key);
    if (!builder) throw new Error(`No builder registered for ${String(key)}`);
    return builder;
  }
}
