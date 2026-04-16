import { cyan, dim } from './colors.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL = 80;

export class Spinner {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text = '';

  start(text: string): void {
    this.text = text;
    if (!process.stderr.isTTY) {
      process.stderr.write(`  ${text}\n`);
      return;
    }
    process.stderr.write('\x1b[?25l'); // hide cursor
    this.timer = setInterval(() => {
      const frame = FRAMES[this.frameIndex % FRAMES.length]!;
      process.stderr.write(`\r\x1b[K  ${cyan(frame)} ${this.text}`);
      this.frameIndex++;
    }, INTERVAL);
  }

  update(text: string): void {
    this.text = text;
    if (!process.stderr.isTTY) {
      process.stderr.write(`  ${text}\n`);
    }
  }

  stop(finalText?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[K');
      process.stderr.write('\x1b[?25h'); // show cursor
    }
    if (finalText) {
      process.stderr.write(`  ${finalText}\n`);
    }
  }

  succeed(text: string): void {
    this.stop(`\x1b[32m\u2714\x1b[39m ${text}`);
  }

  fail(text: string): void {
    this.stop(`\x1b[31m\u2718\x1b[39m ${text}`);
  }

  info(text: string): void {
    this.stop(`${dim('\u2139')} ${text}`);
  }
}
