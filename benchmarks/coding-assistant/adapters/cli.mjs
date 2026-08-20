// Adapters for the competitor CLIs. Each runs headless, in the task's own clone,
// with autonomous editing enabled — the same freedom MigraPilot gets.
import { spawnSync } from 'node:child_process';

const COMMON = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };

export const ADAPTERS = {
  'claude-code': {
    label: 'Claude Code',
    run(root, prompt, timeoutMs) {
      return spawnSync('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--add-dir', root],
        { ...COMMON, cwd: root, timeout: timeoutMs });
    },
  },
  codex: {
    label: 'Codex',
    run(root, prompt, timeoutMs) {
      return spawnSync('codex', ['exec', '--full-auto', '-C', root, prompt],
        { ...COMMON, cwd: root, timeout: timeoutMs });
    },
  },
  copilot: {
    label: 'GitHub Copilot',
    run(root, prompt, timeoutMs) {
      return spawnSync('copilot', ['-p', prompt, '--allow-all', '--add-dir', root],
        { ...COMMON, cwd: root, timeout: timeoutMs });
    },
  },
};
