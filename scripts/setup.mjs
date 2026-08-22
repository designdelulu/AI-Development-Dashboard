#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeMajor = Number(process.versions.node.split('.')[0]);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dashboard = process.platform === 'win32' ? 'ai-dashboard.cmd' : 'ai-dashboard';

function run(command, args) { execFileSync(command, args, { cwd: root, stdio: 'inherit' }); }

if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
  console.error(`AI Development Dashboard requires Node 20 or newer (found ${process.version}).`);
  process.exitCode = 1;
} else if (process.env.AI_DASHBOARD_SETUP_DRY_RUN === '1') {
  console.log('Setup check: Node version is supported. Would run npm install, npm link, and ai-dashboard status.');
} else {
  try {
    // npm install follows the committed package lock. There are currently no
    // external runtime dependencies, but this remains the portable setup path.
    run(npm, ['install']);
    run(npm, ['link']);
    run(dashboard, ['status']);
    console.log('\nSetup complete. Start the dashboard with:\n\n  ai-dashboard open');
  } catch (error) {
    console.error('\nSetup could not finish. No shell profile was changed. You can retry the manual steps:\n\n  npm install\n  npm link\n  ai-dashboard status\n');
    process.exitCode = error.status || 1;
  }
}
