export async function* readJsonLines<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 1_000_000) throw new Error('Streaming response exceeded the line limit');
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
        if (line) yield JSON.parse(line) as T;
      }
      if (done) break;
    }
    if (pending.trim()) yield JSON.parse(pending) as T;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Do not speak partial titles (Dr., Mr.) or text inside reasoning blocks.
export function takeSpeechSegments(text: string, flush = false) {
  const sentences: string[] = [];
  let rest = text;
  while (rest) {
    const boundaries = [...rest.matchAll(/[.!?؟۔।](?:\s+|$)|\n+/gu)];
    const boundary = boundaries.find(match => {
      const end = (match.index ?? 0) + match[0].length;
      if (!flush && end === rest.length && !/\s$/.test(match[0])) return false;
      return !/\b(?:Dr|Mr|Mrs|Ms|Prof|St)\.\s*$/i.test(rest.slice(0, end));
    });
    if (boundary) {
      const end = (boundary.index ?? 0) + boundary[0].length;
      const sentence = rest.slice(0, end).trim(); rest = rest.slice(end);
      if (sentence) sentences.push(sentence);
    } else if (rest.length > 180) {
      const end = rest.lastIndexOf(' ', 180);
      if (end < 30) break;
      sentences.push(rest.slice(0, end).trim()); rest = rest.slice(end).trimStart();
    } else break;
  }
  if (flush && rest.trim()) { sentences.push(rest.trim()); rest = ''; }
  return { sentences, rest };
}
