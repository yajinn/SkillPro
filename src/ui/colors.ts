// Color enablement follows the standard conventions used by the wider Node
// ecosystem (https://no-color.org, https://force-color.org):
//   NO_COLOR set            → disabled
//   --no-color flag         → disabled
//   FORCE_COLOR set         → enabled unconditionally
//   Otherwise, follow TTY   → enabled only if stderr is a terminal
const enabled = (() => {
  if (process.env['NO_COLOR']) return false;
  if (process.argv.includes('--no-color')) return false;
  if (process.env['FORCE_COLOR']) return true;
  return !!process.stderr.isTTY;
})();

const fmt =
  (open: string, close: string) =>
  (text: string): string =>
    enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = fmt('1', '22');
export const dim = fmt('2', '22');
export const italic = fmt('3', '23');
export const underline = fmt('4', '24');
export const red = fmt('31', '39');
export const green = fmt('32', '39');
export const yellow = fmt('33', '39');
export const blue = fmt('34', '39');
export const magenta = fmt('35', '39');
export const cyan = fmt('36', '39');
export const gray = fmt('90', '39');
export const white = fmt('97', '39');

// Brand orange — matches landing-page "run" color (#F97316).
// ANSI 256-color index 208 is the closest standard match; TrueColor falls
// back gracefully in older terminals via the 256-color code.
export const orange = fmt('38;5;208', '39');

export const symbols = {
  check: enabled ? '\u2714' : '+',
  cross: enabled ? '\u2718' : 'x',
  bullet: enabled ? '\u25cf' : '*',
  pointer: enabled ? '\u276f' : '>',
  line: enabled ? '\u2500' : '-',
  ellipsis: enabled ? '\u2026' : '...',
  radioOn: enabled ? '\u25c9' : '(x)',
  radioOff: enabled ? '\u25cb' : '( )',
  checkboxOn: enabled ? '\u25a3' : '[x]',
  checkboxOff: enabled ? '\u25a1' : '[ ]',
} as const;
