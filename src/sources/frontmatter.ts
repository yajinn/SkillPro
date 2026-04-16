/**
 * Simple YAML frontmatter parser for SKILL.md files.
 *
 * Handles the `---\n...\n---` header format. Extracts key: value pairs
 * (simple one-level YAML only -- name, description, tags list).
 * Supports multi-line description with `>` or `|` block scalars.
 * No external YAML dependency.
 */

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

export function parseFrontmatter(
  content: string,
): Record<string, string | string[]> {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return {};
  }

  const fm = match[1];
  const result: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  let currentVal: string[] = [];
  let isBlockScalar = false;
  let isList = false;
  let listItems: string[] = [];

  const lines = fm.split('\n');

  for (const line of lines) {
    // Check for a new key: value pair
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      // Flush previous key
      if (currentKey !== null) {
        if (isList) {
          result[currentKey] = listItems;
        } else {
          result[currentKey] = currentVal.join(' ').trim().replace(/^"|"$/g, '');
        }
      }

      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      // Reset state
      isBlockScalar = false;
      isList = false;
      listItems = [];
      currentVal = [];

      if (rawVal === '>' || rawVal === '|') {
        // Block scalar -- collect continuation lines
        isBlockScalar = true;
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        // Inline array: [tag1, tag2, tag3]
        isList = true;
        const inner = rawVal.slice(1, -1);
        listItems = inner
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
          .filter((s) => s.length > 0);
      } else if (rawVal === '') {
        // Might be followed by list items (- item) or block scalar lines
        // We'll detect on the next line
      } else {
        currentVal = [rawVal];
      }
    } else if (currentKey !== null) {
      const trimmed = line.trim();
      // Check if this is a YAML list item
      if (trimmed.startsWith('- ')) {
        isList = true;
        const item = trimmed
          .slice(2)
          .trim()
          .replace(/^"|"$/g, '')
          .replace(/^'|'$/g, '');
        listItems.push(item);
      } else if (isBlockScalar || currentVal.length > 0) {
        // Continuation of block scalar or multi-line value
        currentVal.push(trimmed);
      }
    }
  }

  // Flush last key
  if (currentKey !== null) {
    if (isList) {
      result[currentKey] = listItems;
    } else {
      result[currentKey] = currentVal.join(' ').trim().replace(/^"|"$/g, '');
    }
  }

  return result;
}
