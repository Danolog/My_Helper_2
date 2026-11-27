/**
 * Odczyt logów produkcji z białą listą pól i maskowaniem.
 *
 * Jedyna droga odczytu logów Cloud Run: czyta wyjście `gcloud logging read
 * --format=json` ze stdin i wypisuje tylko bezpieczne pola (scripts/logs/mask.ts).
 * Skrypt sam nie wywołuje gcloud.
 *
 * Przykład:
 *   gcloud logging read 'resource.type="cloud_run_revision"' --project=<projekt> --limit=50 --format=json | pnpm -s logs:read
 *
 * Flagi:
 *   --json      jeden obiekt JSON na linię zamiast pól rozdzielonych tabulatorem
 *   --message   dołącz zamaskowaną treść komunikatu (domyślnie wyłączona)
 *
 * Kolumny (tryb tekstowy): timestamp, severity, revision, status, method,
 * path, latencyMs, a z --message także message. Puste pole = "-".
 *
 * Wolny tekst komunikatu (imiona, nazwiska, adresy) przechodzi mimo maskowania,
 * więc --message stosujemy tylko wtedy, gdy jest potrzebny.
 */
import { LogInputError, processLogInput } from './mask';

const FLAGS = new Set(['--json', '--message']);
const USAGE =
  'Użycie: <wyjście gcloud logging read --format=json> | pnpm -s logs:read [--json] [--message]';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  const unknown = args.filter((a) => !FLAGS.has(a));
  if (unknown.length > 0) {
    process.stderr.write('Nieznana flaga. ' + USAGE + '\n');
    return 64;
  }
  if (process.stdin.isTTY) {
    process.stderr.write('Brak danych na stdin. ' + USAGE + '\n');
    return 64;
  }

  const input = await readStdin();
  let lines: string[];
  try {
    lines = processLogInput(input, {
      json: args.includes('--json'),
      message: args.includes('--message'),
    });
  } catch (err) {
    // Komunikat ogólny — nigdy fragment surowego wejścia.
    const msg = err instanceof LogInputError ? err.message : 'Nie udało się przetworzyć wejścia.';
    process.stderr.write(msg + '\n');
    return 2;
  }
  if (lines.length > 0) process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write('Nie udało się przetworzyć wejścia.\n');
    process.exitCode = 1;
  },
);
