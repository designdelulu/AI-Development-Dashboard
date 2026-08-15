import fs from 'node:fs';

const CHUNK = 256 * 1024;

export function looksLikeUsageLine(line = '') {
  return /"usage"|token_usage|input_tokens|output_tokens|cache_read|cached_input/.test(line);
}

export function forEachJsonlRecord(file, onRow, { prefilter = null } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(CHUNK, Math.max(size, 1)));
    let leftover = '';
    let position = 0;
    while (position < size) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!read) break;
      position += read;
      leftover += buffer.toString('utf8', 0, read);
      const lines = leftover.split('\n');
      leftover = lines.pop();
      for (const line of lines) visitLine(line, onRow, prefilter);
    }
    if (leftover.trim()) visitLine(leftover, onRow, prefilter);
  } finally {
    fs.closeSync(fd);
  }
}

function visitLine(line, onRow, prefilter) {
  if (!line.trim()) return;
  if (prefilter && !prefilter(line)) return;
  try { onRow(JSON.parse(line)); } catch {}
}
