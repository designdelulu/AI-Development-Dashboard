import os from 'node:os';
import path from 'node:path';

export function lifecyclePaths({ root, dataDir = process.env.AI_DASHBOARD_DATA_DIR } = {}) {
  const resolvedRoot = path.resolve(root || process.cwd());
  const resolvedData = path.resolve(dataDir || path.join(resolvedRoot, '.dashboard-data'));
  return {
    root: resolvedRoot,
    dataDir: resolvedData,
    indexFile: path.join(resolvedData, 'index.json'),
    runtimeFile: path.join(resolvedData, 'runtime.json'),
    logFile: path.join(resolvedData, 'runtime.log'),
    lifecycleFile: path.join(resolvedData, 'lifecycle.jsonl'),
    bugReportsDir: path.join(resolvedData, 'bug-reports'),
    configDir: resolvedData,
    home: os.homedir()
  };
}
