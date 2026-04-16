const enabled =
  !process.env['NO_COLOR'] &&
  !process.argv.includes('--no-color') &&
  process.stderr.isTTY;

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
