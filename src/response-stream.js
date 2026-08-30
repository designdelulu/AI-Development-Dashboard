// Large cached dashboard snapshots must not monopolize the event loop while a
// local browser hydrates. Yield between bounded writes and respect stream
// backpressure so lightweight health and live-state endpoints stay available.
export function writeChunkedText(res, text, { chunkBytes = 64 * 1024, schedule = setImmediate } = {}) {
  const body = String(text ?? '');
  let offset = 0;
  const writeNext = () => {
    if (res.destroyed) return;
    const next = Math.min(body.length, offset + chunkBytes);
    const writable = res.write(body.slice(offset, next));
    offset = next;
    if (offset >= body.length) return res.end();
    if (!writable) return res.once('drain', writeNext);
    schedule(writeNext);
  };
  writeNext();
}
