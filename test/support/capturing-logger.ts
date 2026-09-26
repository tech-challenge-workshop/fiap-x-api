import { LoggerService } from '@nestjs/common';

/** Keeps every line the app logs, so a suite can assert what never appears. */
export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private capture = (...args: unknown[]) => {
    this.lines.push(args.map((arg) => String(arg)).join(' '));
  };
  log = this.capture;
  error = this.capture;
  warn = this.capture;
  debug = this.capture;
  verbose = this.capture;
  fatal = this.capture;

  get text(): string {
    return this.lines.join('\n');
  }
}
