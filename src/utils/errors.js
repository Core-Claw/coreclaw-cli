export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.isCliError = true;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}

export function assertCli(condition, message) {
  if (!condition) {
    throw new CliError(message);
  }
}
