#!/usr/bin/env node

const [major] = process.versions.node.split('.').map(Number);
if (major! < 20) {
  process.stderr.write(
    `SkillForge requires Node.js >= 20 (current: ${process.version})\n`,
  );
  process.exit(1);
}

import('./main.js').then((m) => m.main());
