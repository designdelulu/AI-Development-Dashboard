import os from 'node:os';
import path from 'node:path';

export function lifecyclePaths({ root, dataDir = process.env.AI_DASHBOARD_DATA_DIR } = {}) {
  const resolvedData = path.resolve(dataDir || path.join(root || process.cwd(), '.dashboard-data'));
  return {
    dataDir: resolvedData,
    runtimeFile: path.join(resolvedData, 'runtime.json'),
    logFile: path.join(resolvedData, 'runtime.log'),
    lifecycleFile: path.join(resolvedData, 'lifecycle.jsonl'),
    bugReportsDir: path.join(resolvedData, 'bug-reports'),
    configDir: resolvedData,
    home: os.homedir()
  };
}
