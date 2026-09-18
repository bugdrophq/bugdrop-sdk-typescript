import { requireValue, text } from './opt-in-values.js';

// JSON.parse alone loses duplicate keys and lexical numeric distinctions.
export function parseOptInJson(source: string): unknown {
  let position = 0;
  const whitespace = () => {
    while (/[\t\r\n ]/.test(source[position] ?? '\0')) position++;
  };
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '\\') position++;
      else if (char === '"') return text(JSON.parse(source.slice(start, position)));
    }
    throw new Error('Invalid JSON');
  };
  const value = (depth: number): unknown => {
    whitespace();
    const char = source[position];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      requireValue(depth < 4);
      position++;
      whitespace();
      const object = char === '{';
      const end = object ? '}' : ']';
      const entries: [string, unknown][] = [];
      const values: unknown[] = [];
      const seen = new Set<string>();
      if (source[position] !== end) {
        while (true) {
          whitespace();
          if (object) {
            requireValue(source[position] === '"');
            const key = string();
            requireValue(!seen.has(key));
            seen.add(key);
            whitespace();
            requireValue(source[position++] === ':');
            entries.push([key, value(depth + 1)]);
          } else values.push(value(depth + 1));
          whitespace();
          if (source[position] !== ',') break;
          position++;
        }
      }
      requireValue(source[position++] === end);
      return object ? Object.fromEntries(entries) : values;
    }
    for (const [literal, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (source.startsWith(literal, position)) {
        position += literal.length;
        return result;
      }
    }
    const match = /^(?:0|[1-9][0-9]*)/.exec(source.slice(position));
    requireValue(match);
    position += match[0].length;
    const number = Number(match[0]);
    requireValue(Number.isSafeInteger(number));
    return number;
  };
  const result = value(0);
  whitespace();
  requireValue(position === source.length);
  return result;
}
