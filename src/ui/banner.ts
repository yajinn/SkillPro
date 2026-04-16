import { bold, cyan, dim, gray } from './colors.js';

const VERSION = '2.6.1';

export function printBanner(): void {
  if (!process.stderr.isTTY) return;

  process.stderr.write('\n');
  process.stderr.write(`  ${bold(cyan('SkillPro'))} ${dim(`v${VERSION}`)}\n`);
  process.stderr.write(`  ${gray('Zero-config skill discovery for AI agents')}\n`);
  process.stderr.write('\n');
}

export function getVersion(): string {
  return VERSION;
}
