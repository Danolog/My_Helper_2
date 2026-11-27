import { describe, expect, it } from 'vitest';
import {
  BASE_FIELDS,
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
const WITH_MESSAGE = { message: true } as const;

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
    const entry = toSafeEntry(fullEntry(), WITH_MESSAGE);
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
    expect(Object.keys(JSON.parse(line!))).toEqual([...BASE_FIELDS]);
    const [withMessage] = processLogInput(JSON.stringify([fullEntry()]), { json: true, message: true });
    expect(Object.keys(JSON.parse(withMessage!))).toEqual([...OUTPUT_FIELDS]);
  });

  it('tryb tekstowy: jedna linia, pola rozdzielone tabulatorem, puste jako "-"', () => {
    const entry = toSafeEntry({ timestamp: '2026-11-27T10:15:30Z', textPayload: 'start' }, WITH_MESSAGE);
    expect(formatText(entry, WITH_MESSAGE)).toBe(
      ['2026-11-27T10:15:30Z', '-', '-', '-', '-', '-', '-', 'start'].join('\t'),
    );
  });

  it('message z textPayload ma pierwszeństwo, nie-string w jsonPayload.message daje null', () => {
    expect(toSafeEntry(fullEntry({ textPayload: 'z tekstu' }), WITH_MESSAGE)?.message).toBe('z tekstu');
    expect(
      toSafeEntry(fullEntry({ jsonPayload: { message: { a: 1 } } }), WITH_MESSAGE)?.message,
    ).toBeNull();
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
    const entry = toSafeEntry(
      fullEntry({ jsonPayload: { message: 'login user@example.com z 192.0.2.1' } }),
      WITH_MESSAGE,
    );
    expect(entry?.message).toBe('login [email] z [ip]');
  });
});

describe('flaga --message', () => {
  const raw = JSON.stringify([fullEntry({ textPayload: 'Rezerwacja dla Anna Przykładowa' })]);

  it('bez flagi wpis nie ma pola message', () => {
    const entry = toSafeEntry(fullEntry());
    expect(entry).not.toBeNull();
    expect('message' in entry!).toBe(false);
    expect(Object.keys(entry!).sort()).toEqual([...BASE_FIELDS].sort());
  });

  it('bez flagi JSON nie ma klucza message, a tekst nie ma kolumny z treścią', () => {
    const [jsonLine] = processLogInput(raw, { json: true });
    expect(JSON.parse(jsonLine!)).not.toHaveProperty('message');
    expect(jsonLine).not.toContain('Przykładowa');

    const [textLine] = processLogInput(raw, { json: false });
    expect(textLine!.split('\t')).toHaveLength(BASE_FIELDS.length);
    expect(textLine).not.toContain('Przykładowa');
  });

  it('z flagą message jest na wyjściu (tekst i JSON)', () => {
    const [jsonLine] = processLogInput(raw, { json: true, message: true });
    expect(JSON.parse(jsonLine!).message).toBe('Rezerwacja dla Anna Przykładowa');

    const [textLine] = processLogInput(raw, { json: false, message: true });
    expect(textLine!.split('\t')).toHaveLength(OUTPUT_FIELDS.length);
    expect(textLine).toContain('Rezerwacja dla Anna Przykładowa');
  });

  it('formatText i formatJson bez opcji pomijają message nawet z wpisu, który je ma', () => {
    const entry = toSafeEntry(fullEntry(), WITH_MESSAGE);
    expect(formatText(entry).split('\t')).toHaveLength(BASE_FIELDS.length);
    expect(JSON.parse(formatJson(entry))).not.toHaveProperty('message');
  });
});

// Fikcyjny klucz w formacie Google API składany w teście, żeby skanery sekretów
// w repozytorium nie zgłaszały fałszywego alarmu.
const FAKE_GOOGLE_KEY = 'AIza' + 'SyA1234567890abcdefghijklmnopqrstu';

describe('regresja: wycieki z recenzji', () => {
  // [nazwa, wejście, fragmenty, których nie może być na wyjściu, fragment oczekiwany]
  it.each([
    // 1. e-mail zakodowany w URL
    ['e-mail z %40', 'login jan.kowalski%40example.com failed', ['jan.kowalski', 'example.com'], '[email]'],
    ['e-mail z %2B i %40', 'login jan%2Bpromo%40example.com', ['jan', 'promo', 'example.com'], '[email]'],
    // 2. domena spoza ASCII
    ['e-mail z domeną spoza ASCII', 'user anna@przykład.example', ['anna', 'przykład'], '[email]'],
    // 3. IP przyklejone do klucza
    ['IPv6 po ip:', 'peer ip:2001:db8::1', ['2001', 'db8'], 'ip:[ip]'],
    ['IPv6 po addr:', 'addr:2001:db8::2 x', ['2001', 'db8'], 'addr:[ip] x'],
    ['IPv4 po _', 'client_ip_198.51.100.12 blocked', ['198.51', '100.12'], 'client_ip_[ip] blocked'],
    // 4. dane logowania w URI i nagłówek Basic
    [
      'hasło w connection stringu',
      'postgresql://app:S3cretPass@db.example.com:5432/db',
      ['S3cretPass', 'app:'],
      'postgresql://[dane]@',
    ],
    [
      'hasło w connection stringu z IP',
      'postgresql://app:S3cretPass@192.0.2.3/db',
      ['S3cretPass', '192.0.2.3'],
      'postgresql://[dane]@[ip]/db',
    ],
    [
      'nagłówek Basic',
      'Authorization: Basic YW5uYUBleGFtcGxlLmNvbTpoYXNsbzEyMw==',
      ['YW5u', 'bzEyMw'],
      'Authorization: Basic [token]',
    ],
    // 5. ciasteczka i klucz=wartość bez ?
    [
      'ciasteczko sesji',
      'cookie better-auth.session_token=AbCdEf123.SiGnAtUrE456',
      ['AbCdEf123', 'SiGnAtUrE456'],
      'session_token=[token]',
    ],
    ['token= bez ?', 'reset token=AbC123xyz wygasł', ['AbC123xyz'], 'token=[token]'],
    ['secret: wartość', 'api_secret: TopSecretValue1', ['TopSecretValue1'], 'api_secret: [token]'],
    ['nagłówek Cookie', 'Cookie: sid=abc123; theme=dark', ['abc123', 'theme'], 'Cookie: [cookie]'],
    // 6. klucze dostawców
    ['klucz AIza', `key ${FAKE_GOOGLE_KEY}`, ['AIza', '1234567890', 'abcdefghij'], 'key [token]'],
    ['klucz rk_live_', 'klucz rk_live_abc odrzucony', ['rk_live', 'abc'], 'klucz [token] odrzucony'],
    ['token ghp_', 'token ghp_abcdefghij1234567890', ['ghp_', 'abcdefghij', '1234567890'], '[token]'],
    ['klucz re_', 'klucz re_AbCd1234_xyz', ['re_', 'AbCd', 'xyz'], 'klucz [token]'],
    // 7. identyfikatory
    ['id alfanumeryczny ≥ 20', 'user id kR3xQ8mZpLw2VtY7nB4cHs9dJf6gA1eU', ['kR3x', 'gA1eU'], 'user id [id]'],
    ['UUID bez myślników', 'uuid 3f2a1b4c111142228333444455556666', ['3f2a1b4c', '6666'], 'uuid [uuid]'],
    [
      'UUID po _',
      'salon_3f2a1b4c-1111-4222-8333-444455556666',
      ['3f2a1b4c', '4222', '6666'],
      'salon_[uuid]',
    ],
    // 9. telefony
    ['telefon 3-2-2-2', 'tel 600 70 08 00', ['600', '08 00'], 'tel [telefon]'],
    ['telefon z nawiasem', 'tel (22) 123 45 67', ['(22)', '123'], 'tel [telefon]'],
    ['telefon z kropkami', 'tel 600.700.800', ['600', '800'], 'tel [telefon]'],
    ['telefon po _', 'phone_600-700-800', ['600', '800'], 'phone_[telefon]'],
  ])('%s', (_name, input, forbidden, expected) => {
    const out = maskMessage(input as string);
    for (const fragment of forbidden as string[]) expect(out).not.toContain(fragment);
    expect(out).toContain(expected as string);
  });

  // 8. ścieżka
  it.each([
    ['telefon w ścieżce', '/api/clients/600-700-800', '/api/clients/:id'],
    ['IP w ścieżce', '/api/ip/192.0.2.7', '/api/ip/:id'],
    ['krótkie IP w ścieżce', '/api/ip/1.2.3.4', '/api/ip/:id'],
    ['telefon z kropkami w ścieżce', 'https://app.example.com/api/c/600.700.800?x=1', '/api/c/:id'],
    ['e-mail z domeną spoza ASCII w ścieżce', '/api/u/anna%40przyk%C5%82ad.example', '/api/u/:id'],
  ])('%s', (_name, input, expected) => {
    expect(sanitizePath(input)).toBe(expected);
  });

  it('zwykłe segmenty ścieżki zostają', () => {
    expect(sanitizePath('/api/salons/salon-nazwa/services')).toBe('/api/salons/salon-nazwa/services');
  });
});

describe('kolejność reguł', () => {
  it('maskowanie IP nie zostawia hasła z URI', () => {
    const out = maskMessage('connect postgresql://app:S3cretPass@198.51.100.7:5432/db refused');
    expect(out).toBe('connect postgresql://[dane]@[ip]:5432/db refused');
  });

  it('maskowanie liczby nie zostawia prefiksu klucza', () => {
    for (const input of ['sk_live_1234567890123', 'rk_live_1234567890123', 'ghp_1234567890123456']) {
      const out = maskMessage(`klucz ${input} odrzucony`);
      expect(out).toBe('klucz [token] odrzucony');
    }
  });

  it('e-mail jako hasło w URI nie zostawia loginu', () => {
    const out = maskMessage('smtp://jan@example.com:Haslo123@mail.example.com/');
    expect(out).not.toContain('jan');
    expect(out).not.toContain('Haslo123');
  });

  it('para klucz=wartość zagnieżdżona za zwykłym kluczem', () => {
    expect(maskMessage('a=token=AbC123xyz')).not.toContain('AbC123xyz');
  });
});

describe('bez fałszywych trafień', () => {
  it.each([
    ['data z godziną', 'start 2026-11-27 10:15:30 ok'],
    ['data europejska z godziną', 'start 27.11.2026 10:15 ok'],
    ['odwołanie do metody', 'błąd w Cache::add i std::cout'],
    ['licznik tokenów modelu', 'max_tokens=1000 input_tokens: 250'],
    ['zwykłe słowo Basic', 'Basic plan aktywny'],
    ['IPv6 pętli zwrotnej nie jest daną osobową', 'nasłuch na ::1'],
  ])('%s', (_name, input) => {
    expect(maskMessage(input)).toBe(input);
  });
});

describe('znaki sterujące spoza ASCII', () => {
  it.each([
    ['U+2028', ' '],
    ['U+2029', ' '],
    ['U+0085', '\u0085'],
    ['U+0080', '\u0080'],
    ['U+009B', '\u009b'],
    ['U+009F', '\u009f'],
    ['U+202E', '‮'],
  ])('%s zamieniony na spację', (_name, ch) => {
    expect(maskMessage(`a${ch}b`)).toBe('a b');
  });

  it('zakodowana nowa linia (%0A) też jest spłaszczana', () => {
    expect(maskMessage('a%0Ab')).toBe('a b');
  });
});

describe('bardzo długie wejście', () => {
  it('sekret za granicą przycięcia nie zostaje w połowie', () => {
    const text = 'słowo '.repeat(700) + 'jan.kowalski@example.com';
    const out = maskMessage(text);
    expect(out).not.toContain('jan.kowalski');
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });

  it('jeden bardzo długi ciąg bez spacji nie przechodzi', () => {
    const out = maskMessage('x'.repeat(10000));
    expect(out).not.toContain('x');
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
