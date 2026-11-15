#!/usr/bin/env node
// Obserwator statusów Vercela na commicie (Ethan, #110 / review #108).
//
// Odróżnia „limit wdrożeń" od porażki budowy — oba kończą się statusem
// `failure`, ale znaczą co innego:
//  - limit:          sam `failure` „Deployment rate limited — retry in 24 hours."
//                    BEZ wcześniejszego `pending` „Vercel is deploying your app"
//                    → budowa nie wystartowała, nic to nie mówi o kodzie;
//  - porażka budowy: `pending` „deploying", potem `failure` z innym opisem
//                    → budowa padła, revert;
//  - wdrożenie OK:   `pending`, potem `success`.
//
// Użycie (tylko odczyt statusów commita z GitHuba):
//   gh api repos/<owner>/<repo>/commits/<sha>/statuses --paginate | node infra/ci/vercel-status.mjs
// Wypisuje jedną klasę; kod wyjścia: deployed 0, build-failed 1, rate-limited 3,
// in-progress 4, no-vercel-status 5, failed-other 6.

import { pathToFileURL } from "node:url";

/** @typedef {{ context?: string, state: string, description?: string | null, created_at?: string }} CommitStatus */

export const EXIT_CODES = {
  deployed: 0,
  "build-failed": 1,
  "rate-limited": 3,
  "in-progress": 4,
  "no-vercel-status": 5,
  "failed-other": 6,
};

const RATE_LIMIT_RE = /rate[\s-]?limit/i;
const DEPLOYING_RE = /deploying/i;

/**
 * @param {CommitStatus[]} statuses statusy commita w dowolnej kolejności
 * @param {string} [context] kontekst statusu Vercela (domyślnie "Vercel")
 * @returns {keyof typeof EXIT_CODES}
 */
export function classifyVercelStatuses(statuses, context = "Vercel") {
  const own = statuses
    .filter((s) => (s.context ?? "") === context)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  if (own.length === 0) return "no-vercel-status";

  const last = own[own.length - 1];
  if (last.state === "success") return "deployed";
  if (last.state === "pending") return "in-progress";

  // failure / error
  const sawDeploying = own
    .slice(0, -1)
    .some((s) => s.state === "pending" && DEPLOYING_RE.test(s.description ?? ""));
  if (sawDeploying) return "build-failed";
  if (RATE_LIMIT_RE.test(last.description ?? "")) return "rate-limited";
  return "failed-other";
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  // `gh api --paginate` skleja tablice stron: "][" → ","
  const statuses = JSON.parse(input.trim().replace(/\]\s*\[/g, ",") || "[]");
  const result = classifyVercelStatuses(statuses, process.argv[2] || "Vercel");
  console.log(result);
  process.exitCode = EXIT_CODES[result];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
