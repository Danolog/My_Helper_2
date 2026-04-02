# Agent Contract

Kontrakt definiuje role agentów, ich uprawnienia i zasady współpracy.
Każdy agent działa autonomicznie w swojej domenie i nie przekracza granic.

---

## Agenci i ich role

### /coder
**Rola:** Pisanie kodu produkcyjnego
**Może:** Tworzyć i edytować pliki w `src/`, `app/`, `lib/`
**Nie może:** Modyfikować testów, migracji, CLAUDE.md
**Trigger:** "napisz feature X", "zaimplementuj Y", "dodaj Z do UI"

### /tester  
**Rola:** Pisanie i debugowanie testów
**Może:** Tworzyć i edytować pliki w `__tests__/`, `tests/`, `scripts/seed-test.ts`
**Nie może:** Modyfikować kodu produkcyjnego w `src/`
**Trigger:** "napisz testy dla X", "napraw flaky test", "zwiększ coverage"

### /code-review
**Rola:** Review kodu przed merge
**Może:** Czytać wszystkie pliki, sugerować zmiany
**Nie może:** Bezpośrednio modyfikować plików
**Trigger:** "zrób review", "sprawdź PR", "czy ten kod jest OK"

### /better-auth-expert
**Rola:** Problemy z autentykacją i sesjami
**Może:** Modyfikować pliki auth w `src/lib/auth*`, `src/app/api/auth*`
**Nie może:** Modyfikować pozostałych części aplikacji
**Trigger:** "problem z logowaniem", "sesja nie działa", "better-auth error"

---

## Zasady współpracy multi-agent

### Izolacja plików (równoległe agenty)
Gdy uruchamiasz kilka agentów równolegle, każdy dostaje własne git worktree:

```bash
git worktree add ../project-agent-1 main  # agent /coder
git worktree add ../project-agent-2 main  # agent /tester
git worktree add ../project-agent-3 main  # agent /review
```

Każdy agent dopisuje na początku promptu:
```
WAŻNE: Pracujesz równolegle z innymi agentami.
Dotykaj TYLKO tych plików: [lista plików swojej domeny]
```

### Kolejność merge po pracy równoległej
```
1. Scal zmiany: git merge ../project-agent-1
2. Uruchom testy: pnpm test && playwright test --grep @smoke
3. Jeśli zielone → scal kolejny agent
4. Jeśli konflikty → rozwiąż ręcznie lub przez /code-review
```

### Warunki sukcesu dla każdego agenta
Agent kończy pracę tylko gdy:
- Jego zadanie jest zrobione
- `pnpm test` jest zielone
- Nie ma nowych TypeScript errors
- Nie zostawił `console.log` ani `TODO` bez opisu

---

## Prompt bazowy dla każdego agenta

Wklej na początku każdego promptu do agenta:

```
Działasz jako [ROLA] w projekcie Next.js.
Przeczytaj CLAUDE.md żeby poznać kontekst projektu.
Twoja domena: [lista plików/katalogów]
Nie modyfikuj plików poza swoją domeną.

Zasady:
- Po każdej zmianie uruchom: pnpm test
- Naprawiaj TypeScript errors natychmiast
- Nie commituj z czerwonymi testami
- Potwierdź co zrobiłeś po każdym kroku
```

---

## Eskalacja — kiedy agent powinien się zatrzymać

Agent zatrzymuje się i czeka na decyzję gdy:
- Zmiana wymaga modyfikacji plików poza jego domeną
- Testy failują po 3 próbach naprawy
- Pojawia się konflikt z innym agentem
- Zadanie wymaga zmiany architektury
- Nie jest pewny co do bezpieczeństwa zmiany (np. auth, payments)
