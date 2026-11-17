const REDACTED = "[REDACTED]";

/** Header carrying the user's provider key. Never a URL parameter, never the JSON body. */
export const PROVIDER_KEY_HEADER = "x-provider-key";

/**
 * A user's provider API key.
 *
 * The value lives in a private field and every implicit conversion (string
 * interpolation, JSON.stringify, console.log / util.inspect) yields
 * "[REDACTED]", so a key cannot leak through logging or serialisation by
 * accident. The only way to read it is an explicit `reveal()` call, which
 * adapters make when constructing the provider SDK client.
 *
 * Keys are held for one request only. Synthora never stores them.
 */
export class ApiKey {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Accepts printable ASCII without whitespace, 20–512 characters. Provider
   * prefixes (`sk-…`) are not checked: they change, and the provider is the
   * authority on validity.
   */
  static parse(raw: string | null | undefined): ApiKey | undefined {
    const value = raw?.trim();
    if (!value || value.length < 20 || value.length > 512 || !/^[\x21-\x7e]+$/.test(value)) return undefined;
    return new ApiKey(value);
  }

  static fromRequest(request: Request): ApiKey | undefined {
    return ApiKey.parse(request.headers.get(PROVIDER_KEY_HEADER));
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `ApiKey(${REDACTED})`;
  }
}
