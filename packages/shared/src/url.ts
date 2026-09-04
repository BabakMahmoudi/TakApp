export function isLocalHttpUrl(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  );
}
