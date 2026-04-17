import { bold, orange, dim, gray, white, yellow } from './colors.js';

const VERSION = '2.7.4';
const TAGLINE = 'Zero-config skill discovery for AI coding agents';

/**
 * Print the SkillPro banner — boxed layout with name + version + tagline.
 * Always shown, consistently aligned across terminals.
 */
/** Pad a string to an exact visual width. */
function padToWidth(content: string, contentVisualWidth: number, targetWidth: number): string {
  const deficit = targetWidth - contentVisualWidth;
  return content + ' '.repeat(Math.max(0, deficit));
}

export function printBanner(): void {
  const BOX_WIDTH = 60; // Inner content width (between the two │ borders)
  const border = '─'.repeat(BOX_WIDTH);

  // Row 1: "  ✦  SKILLPRO                               ● v2.6.1  "
  const nameLeft = `  ${yellow('✦')}  ${bold(white('SKILLPRO'))}`;
  const nameLeftVisual = 2 + 1 + 2 + 8; // 13 chars visible
  const versionRight = `${orange('●')} ${bold(orange(`v${VERSION}`))}  `;
  const versionRightVisual = 1 + 1 + 1 + VERSION.length + 2; // "● v2.6.1  " = 10
  const gap = BOX_WIDTH - nameLeftVisual - versionRightVisual;
  const row1 = nameLeft + ' '.repeat(Math.max(1, gap)) + versionRight;

  // Row 2: "  Zero-config skill discovery for AI coding agents     "
  const taglineContent = `  ${gray(TAGLINE)}`;
  const taglineVisual = 2 + TAGLINE.length;
  const row2 = padToWidth(taglineContent, taglineVisual, BOX_WIDTH);

  const emptyRow = ' '.repeat(BOX_WIDTH);

  const lines = [
    '',
    `   ${orange(`╭${border}╮`)}`,
    `   ${orange('│')}${emptyRow}${orange('│')}`,
    `   ${orange('│')}${row1}${orange('│')}`,
    `   ${orange('│')}${row2}${orange('│')}`,
    `   ${orange('│')}${emptyRow}${orange('│')}`,
    `   ${orange(`╰${border}╯`)}`,
    '',
  ];

  for (const line of lines) process.stderr.write(line + '\n');
}

/**
 * Compact inline banner — minimal, for CI or narrow terminals.
 */
export function printCompactBanner(): void {
  process.stderr.write('\n');
  process.stderr.write(`  ${bold(orange('SkillPro'))} ${dim(`v${VERSION}`)} ${dim('·')} ${gray(TAGLINE)}\n`);
  process.stderr.write('\n');
}

export function getVersion(): string {
  return VERSION;
}
