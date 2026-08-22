import os from 'node:os';
import path from 'node:path';

export function autostartPlan({ command, dataDir, platform = process.platform, homedir = os.homedir() } = {}) {
  if (platform === 'darwin') return { supported: true, platform, path: path.join(homedir, 'Library', 'LaunchAgents', 'com.designdelulu.ai-development-dashboard.plist'), command: [command, 'start', '--no-open'], ownership: 'per-user LaunchAgent', enabledByDefault: false };
  if (platform === 'win32') return { supported: true, platform, name: 'AI Development Dashboard', command: [command, 'start', '--no-open'], ownership: 'per-user Task Scheduler entry', enabledByDefault: false };
  return { supported: true, platform, path: path.join(homedir, '.config', 'systemd', 'user', 'ai-development-dashboard.service'), command: [command, 'start', '--no-open'], ownership: 'systemd user unit', enabledByDefault: false };
}
