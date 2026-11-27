import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  OUTPUT_FIELDS,
  SKIPPED_LINE,
  formatJson,
  formatText,
  maskMessage,
  processLogInput,
  sanitizePath,
  toSafeEntry,
} from '../../scripts/logs/mask';

const UUID = '3f2b8c1e-9a4d-4e7f-8b2a-1c0d9e8f7a6b';

/** Pełny, fikcyjny wpis Cloud Run z polami, które muszą zniknąć. */
function fullEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insertId: 'insert-id-secret-123',
    timestamp: '2026-11-27T10:15:30.123456Z',
    receiveTimestamp: '2026-11-27T10:15:31.000000Z',
    severity: 'ERROR',
    logName: 'projects/example-project/logs/run.googleapis.com%2Frequests',
    trace: 'projects/example-project/traces/abcdef0123456789',
    spanId: 'span-id-secret',
    labels: { instanceId: 'instance-secret-label' },
    resource: {
      type: 'cloud_run_revision',
      labels: {
        revision_name: 'app-00042-abc',
        service_name: 'service-secret-name',
        project_id: 'example-project-id',
        location: 'region-secret',
      },
    },
    httpRequest: {
      requestMethod: 'GET',
      requestUrl: `https://app.example.com/api/salons/${UUID}/clients/98765?token=query-secret`,
      status: 500,
      latency: '0.123456s',
      remoteIp: '192.0.2.10',
      serverIp: '192.0.2.20',
      userAgent: 'UserAgent-Secret/1.0',
      referer: 'https://referer-secret.example.com/',
      requestSize: '999',
      responseSize: '888',
      protocol: 'HTTP/1.1',
    },
    jsonPayload: { message: 'Błąd zapisu wizyty', extra: 'payload-secret-field' },
    protoPayload: { secret: 'proto-secret-field' },
    ...overrides,
  };
}

const FORBIDDEN_VALUES = [
  'insert-id-secret-123',
  'abcdef0123456789',
  'span-id-secret',
  'instance-secret-label',
  'service-secret-name',
  'example-project',
  'region-secret',
  'app.example.com',
  'query-secret',
  '192.0.2.10',
  '192.0.2.20',
  'UserAgent-Secret',
  'referer-secret',
  'payload-secret-field',
  'proto-secret-field',
  'HTTP/1.1',
  UUID,
  '98765',
];

describe('biała lista pól', () => {
  it('wpis zawiera dokładnie pola z białej listy', () => {
    const entry = toSafeEntry(fullEntry());
    expect(entry).not.toBeNull();
    expect(Object.keys(entry!).sort()).toEqual([...OUTPUT_FIELDS].sort());
    expect(entry).toEqual({
      timestamp: '2026-11-27T10:15:30.123456Z',
      severity: 'ERROR',
      revision: 'app-00042-abc',
      status: 500,
      method: 'GET',
      path: '/api/salons/:id/clients/:id',
      latencyMs: 123,
      message: 'Błąd zapisu wizyty',
    });
  });

  it.each(FORBIDDEN_VALUES)('wartość spoza białej listy znika z wyjścia: %s', (value) => {
    const raw = JSON.stringify([fullEntry()]);
    const text = processLogInput(raw, { json: false }).join('\n');
    const json = processLogInput(raw, { json: true }).join('\n');
    expect(text).not.toContain(value);
    expect(json).not.toContain(value);
  });

  it('JSON lines ma tylko klucze z białej listy, w ustalonej kolejności', () => {
    const [line] = processLogInput(JSON.stringify([fullEntry()]), { json: true });
    expect(Object.keys(JSON.parse(line!))).toEqual([...OUTPUT_FIELDS]);
  });

  it('tryb tekstowy: jedna linia, pola rozdzielone tabulatorem, puste jako "-"', () => {
    const entry = toSafeEntry({ timestamp: '2026-11-27T10:15:30Z', textPayload: 'start' });
    expect(formatText(entry)).toBe(['2026-11-27T10:15:30Z', '-', '-', '-', '-', '-', '-', 'start'].join('\t'));
  });

  it('message z textPayload ma pierwszeństwo, nie-string w jsonPayload.message daje null', () => {
    expect(toSafeEntry(fullEntry({ textPayload: 'z tekstu' }))?.message).toBe('z tekstu');
    expect(toSafeEntry(fullEntry({ jsonPayload: { message: { a: 1 } } }))?.message).toBeNull();
  });

  it('wartości spoza dozwolonych zbiorów w polach białej listy dają null', () => {
    const entry = toSafeEntry(
      fullEntry({
        severity: 'user@example.com',
        resource: { labels: { revision_name: 'Revision With Spaces 192.0.2.1' } },
        httpRequest: { requestMethod: 'GET /secret', status: 'abc', latency: 'długo', requestUrl: 42 },
      }),
    );
    expect(entry).toMatchObject({
      severity: null,
      revision: null,
      status: null,
      method: null,
      path: null,
      latencyMs: null,
    });
  });

  it('latency w postaci {seconds, nanos}', () => {
    const entry = toSafeEntry(fullEntry({ httpRequest: { latency: { seconds: 1, nanos: 500000000 } } }));
    expect(entry?.latencyMs).toBe(1500);
  });
});

describe('path', () => {
  it('usuwa host, query i fragment; UUID i liczby na :id', () => {
    expect(sanitizePath(`https://app.example.com/api/a/${UUID}/b/987?x=1#frag`)).toBe('/api/a/:id/b/:id');
  });

  it('ścieżka bez hosta i pusta ścieżka', () => {
    expect(sanitizePath('/api/health?probe=1')).toBe('/api/health');
    expect(sanitizePath('https://app.example.com')).toBe('/');
  });

  it('segmenty z e-mailem lub wyglądające na token też na :id', () => {
    expect(sanitizePath('/api/unsubscribe/user%40example.com')).toBe('/api/unsubscribe/:id');
    expect(sanitizePath('/api/reset/abcDEF123456ghiJKL7890')).toBe('/api/reset/:id');
    expect(sanitizePath('/api/x/%E0%A4%A')).toBe('/api/x/:id');
  });
});

describe('maskowanie message', () => {
  it.each([
    ['e-mail', 'Wysłano do jan.kowalski@example.com', 'Wysłano do [email]'],
    ['IPv4', 'Połączenie z 192.0.2.55 odrzucone', 'Połączenie z [ip] odrzucone'],
    ['IPv6 skrócony', 'klient 2001:db8::1 rozłączony', 'klient [ip] rozłączony'],
    ['IPv6 pełny', 'klient 2001:db8:0:0:0:0:0:1 rozłączony', 'klient [ip] rozłączony'],
    ['IPv6 z IPv4', 'klient ::ffff:192.0.2.7 rozłączony', 'klient [ip] rozłączony'],
    ['UUID', `salon ${UUID} nie istnieje`, 'salon [uuid] nie istnieje'],
    ['telefon PL ze spacjami', 'SMS do 600 100 200 wysłany', 'SMS do [telefon] wysłany'],
    ['telefon PL z myślnikami', 'SMS do 600-100-200 wysłany', 'SMS do [telefon] wysłany'],
    ['telefon PL +48', 'SMS do +48 600 100 200 wysłany', 'SMS do [telefon] wysłany'],
    ['telefon PL 0048', 'SMS do 0048600100200 wysłany', 'SMS do [telefon] wysłany'],
    ['telefon PL stacjonarny', 'tel. 91 123 45 67 zajęty', 'tel. [telefon] zajęty'],
    ['telefon E.164', 'call +14155550123 failed', 'call [telefon] failed'],
    ['Bearer', 'Authorization: Bearer abc.DEF-123_xyz== odrzucony', 'Authorization: Bearer [token] odrzucony'],
    ['sk_', 'klucz sk_test_przyklad nieprawidłowy', 'klucz [token] nieprawidłowy'],
    ['whsec_', 'podpis whsec_przyklad nie pasuje', 'podpis [token] nie pasuje'],
    ['URL z query', 'fetch https://api.example.com/v1/x?key=abc&u=2 failed', 'fetch [url] failed'],
    ['ścieżka z query', 'GET /api/confirm?token=abc123 404', 'GET /api/confirm?[query] 404'],
    ['ciąg cyfr > 8', 'zamówienie 1234567890123 odrzucone', 'zamówienie [liczba] odrzucone'],
  ])('%s', (_name, input, expected) => {
    expect(maskMessage(input)).toBe(expected);
  });

  it('nie rusza krótkich liczb, godzin ani URL bez query', () => {
    const text = 'retry 3 o 10:15:30 na https://api.example.com/v1/health kod 12345678';
    expect(maskMessage(text)).toBe(text);
  });

  it('znaki sterujące (tab, nowa linia) zamienia na spacje', () => {
    expect(maskMessage('a\tb\nc')).toBe('a b c');
  });

  it('maskuje w jsonPayload.message wpisu', () => {
    const entry = toSafeEntry(fullEntry({ jsonPayload: { message: 'login user@example.com z 192.0.2.1' } }));
    expect(entry?.message).toBe('login [email] z [ip]');
  });
});

describe('obcinanie', () => {
  it(`obcina message do ${MAX_MESSAGE_LENGTH} znaków`, () => {
    const out = maskMessage('a'.repeat(1000));
    expect(Array.from(out)).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });

  it('nie obcina message o długości dokładnie limitu', () => {
    const text = 'b'.repeat(MAX_MESSAGE_LENGTH);
    expect(maskMessage(text)).toBe(text);
  });

  it('maskuje przed obcięciem — sekret na granicy nie zostaje w połowie', () => {
    const text = 'x'.repeat(290) + ' user@example.com';
    const out = maskMessage(text);
    expect(out).not.toContain('user');
    expect(out).toContain('[email]');
  });
});

describe('wpisy uszkodzone i puste wejście', () => {
  it.each([
    ['string', 'surowy tekst user@example.com'],
    ['liczba', 42],
    ['null', null],
    ['tablica', ['x']],
    ['brak timestamp', { textPayload: 'user@example.com' }],
    ['zły timestamp', { timestamp: 'wczoraj 192.0.2.1', textPayload: 'x' }],
  ])('wpis uszkodzony (%s) daje [pominięty wpis]', (_name, raw) => {
    expect(toSafeEntry(raw)).toBeNull();
    const [line] = processLogInput(JSON.stringify([raw]), { json: false });
    expect(line).toBe(SKIPPED_LINE);
    const [jsonLine] = processLogInput(JSON.stringify([raw]), { json: true });
    expect(JSON.parse(jsonLine!)).toEqual({ skipped: true, message: SKIPPED_LINE });
  });

  it('uszkodzony wpis nie przerywa pozostałych', () => {
    const lines = processLogInput(JSON.stringify([fullEntry(), 'zepsuty', fullEntry()]), { json: false });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(SKIPPED_LINE);
    expect(lines[0]).toContain('/api/salons/:id/clients/:id');
  });

  it('pusta tablica i puste wejście dają puste wyjście', () => {
    expect(processLogInput('[]', { json: false })).toEqual([]);
    expect(processLogInput('[]', { json: true })).toEqual([]);
    expect(processLogInput('  \n', { json: false })).toEqual([]);
  });

  it('wejście nie-JSON lub nie-tablica rzuca błąd bez surowego tekstu', () => {
    expect(() => processLogInput('nie json user@example.com', { json: false })).toThrow(/JSON/);
    expect(() => processLogInput('nie json user@example.com', { json: false })).not.toThrow(/example/);
    expect(() => processLogInput('{"a":"user@example.com"}', { json: false })).toThrow(/tablicą/);
  });

  it('formatJson i formatText dla null', () => {
    expect(formatText(null)).toBe(SKIPPED_LINE);
    expect(formatJson(null)).toContain('pominięty');
  });
});
