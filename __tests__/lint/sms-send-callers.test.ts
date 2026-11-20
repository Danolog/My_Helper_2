// @vitest-environment node
/**
 * Strażnik treści SMS: poza `src/lib/sms.ts` nikt nie woła ogólnego `sendSms`
 * z własnoręcznie złożoną treścią. Treść SMS idzie na numer osoby trzeciej
 * i może zawierać tekst z publicznego formularza albo z nazwy konta, więc
 * składają ją wyłącznie szablony modułu SMS (reguły imienia, tekstu
 * właściciela i daty w GSM-7). Nowa wysyłka = nowy szablon w `src/lib/sms.ts`.
 *
 * Mechanizm: każdy plik TS w `src/` (bez plików testów) jest parsowany przez
 * kompilator TS. Plik jest wołającym `sendSms`, gdy w jego drzewie składni
 * występuje identyfikator `sendSms` (import, alias `as`, wywołanie,
 * `moduł.sendSms`, destrukturyzacja) albo literał tekstowy "sendSms"
 * (`moduł["sendSms"]`). Osobno: import przestrzeni nazw, `import()`
 * i `require()` modułu SMS są naruszeniem — przez nie nazwę można złożyć
 * dynamicznie i ominąć skan.
 *
 * Kontrakt: lista wołających ma być DOKŁADNIE równa ALLOWED_CALLERS. Nowy
 * wpis wymaga przeglądu bezpieczeństwa i uzasadnienia w komentarzu przy nim.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const SMS_MODULE = "src/lib/sms.ts";
const SEND_SMS = "sendSms";

/**
 * Zamknięta lista plików spoza modułu SMS, które wołają `sendSms`.
 * - `src/lib/waiting-list.ts`: oferta zwolnionego terminu; treść wyłącznie
 *   z `buildWaitingListSms` (oferta liczona przed zajęciem wpisu, wysyłka
 *   po zajęciu — dlatego builder i wysyłka są rozdzielone).
 */
const ALLOWED_CALLERS = ["src/lib/waiting-list.ts"];

const CONTRACT =
  "plik spoza src/lib/sms.ts woła sendSms: treść SMS ma składać szablon modułu SMS" +
  " (dodaj eksport build…Sms/send…Sms w src/lib/sms.ts i wołaj go); wpis do ALLOWED_CALLERS" +
  " tylko po przeglądzie bezpieczeństwa, z uzasadnieniem";

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

/** Pliki TS w `src/` bez deklaracji typów i plików testów. */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "__tests__") walk(p, acc);
    } else if (
      /\.(ts|tsx|mts|cts)$/.test(e.name) &&
      !/\.d\.[cm]?ts$/.test(e.name) &&
      !/\.(test|spec)\./.test(e.name)
    ) {
      acc.push(p);
    }
  }
  return acc;
}

/** Czy specyfikator importu z pliku `fromAbs` wskazuje moduł SMS (alias `@/` albo ścieżka względna). */
function isSmsModule(spec: string, fromAbs: string): boolean {
  let target: string;
  if (spec.startsWith("@/")) target = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) target = path.resolve(path.dirname(fromAbs), spec);
  else return false;
  const r = rel(target).replace(/\.(ts|js)$/, "");
  return r === "src/lib/sms" || r === "src/lib/sms/index";
}

type Analysis = {
  files: number;
  callers: string[];
  dynamicAccess: string[];
  smsModuleUsesSendSms: boolean;
};

function analyze(): Analysis {
  const files = walk(SRC);
  const callers = new Set<string>();
  const dynamicAccess: string[] = [];
  let smsModuleUsesSendSms = false;

  for (const abs of files) {
    const file = rel(abs);
    const text = fs.readFileSync(abs, "utf8");
    const kind = abs.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);

    let usesSendSms = false;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === SEND_SMS) usesSendSms = true;
      if (ts.isStringLiteralLike(node) && node.text === SEND_SMS) usesSendSms = true;

      if (file !== SMS_MODULE) {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.importClause?.namedBindings &&
          ts.isNamespaceImport(node.importClause.namedBindings) &&
          !node.importClause.isTypeOnly &&
          isSmsModule(node.moduleSpecifier.text, abs)
        ) {
          dynamicAccess.push(`${file}: import * as ${node.importClause.namedBindings.name.text}`);
        }
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
          const isRequire = ts.isIdentifier(callee) && callee.text === "require";
          const arg = node.arguments[0];
          if ((isImport || isRequire) && arg && ts.isStringLiteralLike(arg) && isSmsModule(arg.text, abs)) {
            dynamicAccess.push(`${file}: ${isImport ? "import" : "require"}('${arg.text}')`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (file === SMS_MODULE) smsModuleUsesSendSms = usesSendSms;
    else if (usesSendSms) callers.add(file);
  }

  return {
    files: files.length,
    callers: [...callers].sort(),
    dynamicAccess: dynamicAccess.sort(),
    smsModuleUsesSendSms,
  };
}

describe("strażnik treści SMS: sendSms tylko z modułu SMS i z zamkniętej listy", () => {
  let a: Analysis;

  beforeAll(() => {
    a = analyze();
  }, 120_000);

  it("skan działa (fail-closed): pliki src/ znalezione, moduł SMS sam woła sendSms", () => {
    expect(a.files).toBeGreaterThan(100);
    expect(a.smsModuleUsesSendSms, "skan nie widzi sendSms w src/lib/sms.ts — skaner albo nazwa się rozjechały").toBe(true);
  });

  it("wołający sendSms spoza src/lib/sms.ts: lista DOKŁADNIE równa ALLOWED_CALLERS", () => {
    expect(a.callers, CONTRACT).toEqual([...ALLOWED_CALLERS].sort());
  });

  it("brak importu przestrzeni nazw, import() i require() modułu SMS poza nim samym", () => {
    expect(a.dynamicAccess, "dostęp do modułu SMS omijający skan nazw — importuj nazwane szablony").toEqual([]);
  });
});
