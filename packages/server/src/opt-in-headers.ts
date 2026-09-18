import { OPT_IN_MEDIA_TYPE } from './opt-in-protocol.js';
import { requireValue } from './opt-in-values.js';

// Approved P0 response-header clarification v2, SHA256
// 8e088dc9ab74017f17b20fcb47671fd807f2717e7169821c31faab4762466711.
// Platform-hidden multiplicity still requires independent platform qualification.
export function responseLength(response: Response): number | undefined {
  requireValue(response.status === 200 && !response.redirected);
  const allowed = ['content-type', 'cache-control', 'content-length', 'date', 'server'];
  const seen = new Set<string>();
  let size = 0;
  response.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    requireValue(allowed.includes(name) && !seen.has(name));
    seen.add(name);
    size += Buffer.byteLength(`${name}:${value}\r\n`);
  });
  requireValue(seen.size <= 64 && size <= 32_768);
  requireValue(response.headers.get('content-type') === OPT_IN_MEDIA_TYPE);
  requireValue(response.headers.get('cache-control') === 'no-store');
  const date = response.headers.get('date');
  if (date !== null) validDate(date);
  const server = response.headers.get('server');
  requireValue(server === null || /^[\x20-\x2b\x2d-\x7e]+$/.test(server));
  const length = response.headers.get('content-length');
  if (length === null) return undefined;
  requireValue(/^(0|[1-9][0-9]*)$/.test(length) && Number(length) <= 65_536);
  return Number(length);
}

function validDate(value: string): void {
  const match =
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/.exec(
      value
    );
  requireValue(match);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const date = new Date(0);
  date.setUTCFullYear(Number(match[4]), months.indexOf(match[3]!), Number(match[2]));
  date.setUTCHours(Number(match[5]), Number(match[6]), Number(match[7]), 0);
  requireValue(date.toUTCString() === value);
}
