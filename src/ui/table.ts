import { dim } from './colors.js';

/** Render rows as left-aligned columns with consistent spacing. */
export function renderTable(rows: string[][], indent = 2): string {
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const widths: number[] = Array.from({ length: colCount }, () => 0);

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      // Strip ANSI for width calculation
      const plain = row[i]!.replace(/\x1b\[\d+m/g, '');
      widths[i] = Math.max(widths[i]!, plain.length);
    }
  }

  const prefix = ' '.repeat(indent);
  return rows
    .map((row) =>
      prefix +
      row
        .map((cell, i) => {
          const plain = cell.replace(/\x1b\[\d+m/g, '');
          return cell + ' '.repeat(Math.max(0, widths[i]! - plain.length));
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** Render a key-value summary line. */
export function summaryLine(label: string, value: string): string {
  return `  ${dim(label)} ${value}`;
}
