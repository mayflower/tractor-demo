export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class ProviderError extends Error {
  constructor(code, message, {status = 502} = {}) { super(message); this.code = code; this.status = status; }
}
