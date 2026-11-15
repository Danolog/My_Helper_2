// @vitest-environment node
/**
 * tests/global-setup.ts (Playwright globalSetup) loguje konto testowe przez API
 * i zapisuje stan sesji — TYLKO gdy baseURL wskazuje środowisko lokalne
 * (host po sparsowaniu URL ∈ {localhost, 127.0.0.1, [::1]}). Każdy inny adres,
 * w tym pusty i niesparsowalny, jest traktowany jako zdalny (fail-closed):
 * zero żądań, zero pliku stanu. Testy @production nie potrzebują sesji.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const post = vi.fn();
  const dispose = vi.fn();
  const newContext = vi.fn(async () => ({ post, dispose }));
  return {
    post,
    dispose,
    newContext,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('@playwright/test', () => ({ request: { newContext: h.newContext } }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    existsSync: h.existsSync,
    mkdirSync: h.mkdirSync,
    writeFileSync: h.writeFileSync,
  };
  return { ...mocked, default: mocked };
});

import globalSetup from '../../tests/global-setup';
import type { FullConfig } from '@playwright/test';

function configWith(baseURL: string | undefined): FullConfig {
  return { projects: [{ use: { baseURL } }] } as unknown as FullConfig;
}

function okResponse() {
  return {
    ok: () => true,
    status: () => 200,
    text: async () => '',
    headersArray: () => [{ name: 'set-cookie', value: 'session_token=abc; Path=/; HttpOnly' }],
  };
}

describe('e2e global-setup — logowanie tylko lokalnie', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.post.mockResolvedValue(okResponse());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['https://x.vercel.app'],
    ['https://tag---service-123.europe-central2.run.app'],
    ['https://localhost.example.com'],
    ['http://localhost.example.com:3000'],
    ['https://example.com/localhost'],
    ['http://127.0.0.1.example.com'],
    ['https://user@localhost.evil.test'],
    [''],
    ['not a url'],
    ['localhost:3000'],
    [undefined],
  ])('zdalny/niepoprawny baseURL %j: zero żądań i brak pliku stanu', async (baseURL) => {
    await expect(globalSetup(configWith(baseURL))).resolves.toBeUndefined();

    expect(h.newContext).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.writeFileSync).not.toHaveBeenCalled();
    expect(h.mkdirSync).not.toHaveBeenCalled();

    // Jedna linia logu, bez adresu docelowego.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0] ?? '');
    if (baseURL) expect(line).not.toContain(baseURL);
    expect(line).not.toMatch(/https?:\/\//);
    expect(line).not.toContain('@');
  });

  it.each([
    ['http://localhost:3000'],
    ['http://127.0.0.1:3000'],
    ['http://[::1]:3000'],
    ['http://LOCALHOST:3000'],
  ])('lokalny baseURL %s: logowanie przez API i zapis stanu jak dotąd', async (baseURL) => {
    await globalSetup(configWith(baseURL));

    expect(h.newContext).toHaveBeenCalledTimes(1);
    expect(h.newContext).toHaveBeenCalledWith({ baseURL });
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.post.mock.calls[0]?.[0]).toBe('/api/auth/sign-in/email');
    expect(h.writeFileSync).toHaveBeenCalledTimes(1);
    const [statePath, body] = h.writeFileSync.mock.calls[0] as unknown as [string, string];
    expect(statePath).toMatch(/[\\/]tests[\\/]\.auth[\\/]owner\.json$/);
    expect(JSON.parse(body).cookies).toHaveLength(1);
    expect(h.dispose).toHaveBeenCalledTimes(1);
  });
});
