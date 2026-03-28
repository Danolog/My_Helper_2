## Context Management

Agent MUSI aktywnie zarzadzac oknem kontekstowym podczas dlugich zadan.

### Checkpoints

1. **Przed duzym zadaniem** — zapisz plan do `memory/current-task.md`
2. **Po kazdym etapie** — zaktualizuj `memory/current-task.md`
3. **Regularnie kompresuj kontekst** — po kazdych 3-4 etapach uzyj `/compact`
4. **Przed `/clear`** — ZAWSZE zaktualizuj `memory/current-task.md`
5. **Po `/clear` lub nowej sesji** — przeczytaj `memory/current-task.md` i `memory/MEMORY.md`

### Format `memory/current-task.md`

```markdown
# Biezace zadanie
**Cel:** [opis]
**Rozpoczeto:** [data]
**Status:** w trakcie / zakonczone

## Plan
- [x] Krok 1
- [ ] Krok 2 (NASTEPNY)

## Kluczowe decyzje
## Zmodyfikowane pliki
## Problemy i rozwiazania
## Notatki dla nastepnej sesji
```

## Known Issues

- [ ] Weryfikacja autorow sesji (timeout 15 min)
- [ ] Walidacje formularzy we wszystkich CRUD
- [ ] Obsluga bledow w endpointach AI
- [ ] Testy responsywnosci mobile-first
- [ ] E2E stabilnosc w CI — hydration timing, cold start delays (aktywnie naprawiane)
