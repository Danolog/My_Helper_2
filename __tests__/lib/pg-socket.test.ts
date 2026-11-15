// @vitest-environment node
/**
 * infra/db/pg-socket.mjs (K-1, #121 a): Cloud SQL przez gniazdo uniksowe dla
 * aplikacji (src/lib/db.ts) i joba migracji (infra/db/migrate.mjs).
 * Mutacje (wynik w PR): bez usuwania `host` z adresu; ścieżka bez
 * `/.s.PGSQL.<port>`; zamiana także hosta, który nie zaczyna się od `/`;
 * błąd parsowania z oryginalnym komunikatem; migrate.mjs bez helpera.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { socketAwareConnection } from "../../infra/db/pg-socket.mjs";

const ROOT = process.cwd();
const SECRET_URL =
  "postgresql://myhelper_owner:pw@localhost/myhelper?host=/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg";

describe("pg-socket: socketAwareConnection", () => {
  it("format sekretu Ethana → gniazdo Cloud SQL, adres bez host", () => {
    expect(socketAwareConnection(SECRET_URL)).toEqual({
      url: "postgresql://myhelper_owner:pw@localhost/myhelper",
      path: "/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg/.s.PGSQL.5432",
    });
  });

  it("port z adresu trafia do nazwy gniazda; inne parametry zostają; ukośnik na końcu katalogu ignorowany", () => {
    expect(socketAwareConnection("postgresql://u:p@localhost:6543/db?application_name=mh&host=/tmp/pg/")).toEqual({
      url: "postgresql://u:p@localhost:6543/db?application_name=mh",
      path: "/tmp/pg/.s.PGSQL.6543",
    });
  });

  it.each([
    "postgresql://u:p@127.0.0.1:5432/x",
    "postgresql://u:p@db.example.com/x?sslmode=require",
    "postgresql://u:p@localhost/x?host=db.internal",
  ])("bez gniazda: %s bez zmian, path undefined", (url) => {
    expect(socketAwareConnection(url)).toEqual({ url, path: undefined });
  });

  it("dwa parametry host → błąd (niejednoznaczne)", () => {
    expect(() => socketAwareConnection("postgresql://u:p@localhost/x?host=/a&host=/b")).toThrow(
      "more than one host parameter",
    );
  });

  it("nieprawidłowy adres → błąd bez adresu, bez cause i bez input", () => {
    let err: unknown;
    try {
      socketAwareConnection("postgresql://u:TAJNE-HASLO@ho st/x");
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe("POSTGRES_URL is not a valid URL");
    expect((err as Error).cause).toBeUndefined();
    expect(JSON.stringify(err) + String((err as Error).stack)).not.toContain("TAJNE-HASLO");
  });
});

describe("pg-socket: migrate.mjs", () => {
  it("migrate.mjs łączy się przez helper (path), Dockerfile kopiuje helper obok", () => {
    const src = readFileSync(join(ROOT, "infra/db/migrate.mjs"), "utf8");
    expect(src).toContain('import { socketAwareConnection } from "./pg-socket.mjs";');
    expect(src).toMatch(/postgres\(connection\.url, \{\n\s+\.\.\.\(connection\.path \? \{ path: connection\.path \} : \{\}\)/);
    const docker = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    expect(docker).toContain("COPY infra/db/migrate.mjs ./migrate.mjs\nCOPY infra/db/pg-socket.mjs ./pg-socket.mjs\n");
  });

  it.each([
    ["nieprawidłowy adres", "postgresql://u:TAJNE-HASLO@ho st/x"],
    ["gniazdo, którego nie ma", "postgresql://u:TAJNE-HASLO@localhost/x?host=/nonexistent-cloudsql/p:r:i"],
  ])("%s: kod 1, hasło i adres nie trafiają do wyjścia", (_l, url) => {
    const r = spawnSync("node", [join(ROOT, "infra/db/migrate.mjs")], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, POSTGRES_URL: url, PGCONNECT_TIMEOUT: "3" },
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain("TAJNE-HASLO");
    expect(r.stdout + r.stderr).toContain("[migrate] failed");
  });
});
