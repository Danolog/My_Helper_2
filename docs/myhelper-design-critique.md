# MyHelper — Design Critique & Rekomendacje UX/UI

**Data:** 15 marca 2026
**Styl zachowany:** Warm & Premium (terracotta)
**Typografia:** Playfair Display + DM Sans (bez zmian)
**Dark mode:** Priorytet — od razu

---

## 1. Co działa dobrze (zachować)

**System kolorów (9/10)** — oklch color space to nowoczesne podejście. Paleta terracotta + gold + sage jest spójna i wyróżnia MyHelper od konkurencji (Booksy = fiolet, Versum = niebieski). Warm shadows (`rgba(45,31,20,...)`) to świetny detal.

**Typografia (8/10)** — Playfair Display jako display font nadaje premium charakter. DM Sans jako body font jest czytelny i dobrze się skaluje. Połączenie serif + sans-serif tworzy elegancki kontrast.

**Landing page (8/10)** — Hero z 90vh, Framer Motion animacje, gradient blobs, floating cards z calendar mockup i stats. Profesjonalne wrażenie. Sekcje: Trust bar, Features (3-kolumnowy grid), Pricing, Testimonials.

**Sidebar (7/10)** — 3px left border jako active indicator, role-based navigation, aria-labels na mobile, Sheet drawer na mobile < 1024px. Solidna baza.

**Glass effect** — `.glass` class z backdrop-filter blur(12px) dobrze współgra z warm aesthetic.

---

## 2. Problemy do naprawienia

### 2.1 Dark Mode — NIEDOKOŃCZONY (Priorytet Krytyczny)

**Stan obecny:** Tokeny CSS dla dark mode istnieją w `globals.css` (linie 116-166), ThemeProvider jest skonfigurowany z `defaultTheme="system"` i `enableSystem`. ALE:

**Problemy:**
- **Brak testowania** — audit wskazuje dark mode jako niedotestowany
- **`disableTransitionOnChange`** jest włączony — przełączanie motywu jest nagłe, bez smooth transition
- **Kontrast w dark mode** — `--muted-foreground: oklch(0.60 0.02 50)` na `--background: oklch(0.15 0.02 50)` daje kontrast ~4.5:1 — minimalnie przechodzi WCAG AA, ale dla drobnego tekstu może być za mało
- **Border visibility** — `--border: oklch(0.95 0.01 70 / 10%)` to bardzo subtelna linia na ciemnym tle — karty mogą się zlewać
- **Chart colors** — dark mode chart palette jest zbyt ciemna, trudna do odczytania
- **Sidebar dark** — `oklch(0.17 0.02 50)` jest zbyt bliski background `oklch(0.15 0.02 50)` — brak wizualnego oddzielenia

**Rekomendacja:**
```css
.dark {
  /* Zwiększ kontrast border */
  --border: oklch(0.95 0.01 70 / 18%);  /* było 10% */

  /* Jaśniejszy muted-foreground */
  --muted-foreground: oklch(0.65 0.02 50);  /* było 0.60 */

  /* Sidebar — ciemniejszy niż bg dla separacji */
  --sidebar: oklch(0.12 0.02 50);  /* było 0.17 */

  /* Jaśniejsze chart colors */
  --chart-1: oklch(0.75 0.10 55);  /* było 0.70 */
  --chart-3: oklch(0.55 0.10 145); /* było 0.50 */
}
```

### 2.2 Accessibility — SŁABA (5/10)

**Problemy znalezione:**
- **Skip link** — brak `<a href="#main-content">` na początku body. `<main id="main-content">` istnieje, ale skip link nie
- **Focus visible** — brak globalnego custom `:focus-visible` style. Defaultowy outline jest niewidoczny na terracotta elementach
- **Keyboard navigation w kalendarzu** — nieprzetestowana, drag-drop wymaga alternatywy klawiaturowej
- **aria-label na feature cards** — brak. Ikony bez tekstu alternatywnego
- **Kontrast CTA** — primary button (`oklch(0.60 0.12 45)`) na `primary-foreground` (`oklch(0.99 0.005 80)`) — ok, ale hover states mogą tracić kontrast
- **Reduced motion** — Framer Motion animacje nie respektują `prefers-reduced-motion`

**Rekomendacja — dodaj do globals.css:**
```css
/* Skip link */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  z-index: 100;
  padding: 8px 16px;
  background: var(--primary);
  color: var(--primary-foreground);
  transition: top 0.3s;
}
.skip-link:focus {
  top: 0;
}

/* Focus visible */
:focus-visible {
  outline: 2px solid oklch(from var(--primary) l c h);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 2.3 Mobile UX — WYMAGA PRACY (7/10)

**Problemy:**
- **Sidebar breakpoint** — `lg:hidden` (1024px) jest za wysoki. Na tabletach 768-1024px sidebar zajmuje nieproporcjonalnie dużo miejsca. Powinno być `md:flex` (768px) dla sidebar
- **Landing hero** — `text-6xl sm:text-7xl md:text-8xl lg:text-9xl` — na mobile 6xl (60px) to za dużo dla polskich słów ("Twój Salon, znacznie więcej"). Na 360px szerokości tekst będzie ciasny
- **Touch targets** — sidebar nav links mają `py-2` (8px top/bottom) — za małe dla mobile. Minimum 44px dla touch target (WCAG)
- **Brak bottom navigation** — na mobile hamburger menu wymaga sięgnięcia na górę ekranu. Kluczowe akcje (Kalendarz, Klienci, AI) powinny być w bottom bar

**Rekomendacja:**
```
Mobile (< 768px):
  - Bottom navigation bar z 4-5 kluczowymi akcjami
  - Hero h1: text-4xl (36px) zamiast text-6xl
  - Nav links: min-h-[44px] py-3

Tablet (768-1024px):
  - Sidebar collapsible (64px icons only)
  - Content area pełna szerokość
```

### 2.4 Empty States — BRAK DESIGNU

**Stan obecny:** Audit wskazuje brak dedykowanych empty states w komponentach. `error.tsx`, `global-error.tsx`, `not-found.tsx` istnieją, ale:
- Brak empty state dla: lista klientów (pusta), produkty, galeria, raporty bez danych
- Brak skeleton screens w data-heavy widokach

**Rekomendacja:**
Stworzyć reużywalny komponent `<EmptyState>`:
```tsx
// src/components/ui/empty-state.tsx
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
}
```
Styl: ikona w kolorze primary/10, duży tekst z Playfair Display, opis w muted-foreground, CTA button.

### 2.5 Loading States — NIESPÓJNE

- `skeleton.tsx` i `spinner.tsx` istnieją, ale nie ma `loading.tsx` dla każdej route grupy
- Dashboard z 76KB page.tsx ładuje się wolno — potrzebuje streaming z Suspense boundaries

**Rekomendacja:**
Dodaj `loading.tsx` do: `/dashboard/`, `/dashboard/clients/`, `/dashboard/reports/`, `/dashboard/calendar/` z skeleton screens odzwierciedlającymi layout strony.

### 2.6 Sidebar Navigation — DROBNE POPRAWKI

**Problemy:**
- **11 pozycji** — za dużo na pierwszy rzut oka. Brak grupowania (np. "Zarządzanie", "Marketing", "Finanse")
- **Ikona Users** użyta dwukrotnie — dla "Klienci" i "Pracownicy". Mylące
- **Brak breadcrumbs** — przy 50+ podstronach użytkownik traci orientację

**Rekomendacja:**
```
Grupowanie sidebar:
─ GŁÓWNE
  Pulpit | Kalendarz
─ ZARZĄDZANIE
  Klienci | Usługi | Pracownicy | Magazyn
─ MARKETING
  Galeria | Promocje | Asystent AI [PRO]
─ FINANSE
  Raporty | Subskrypcja
```
Użyj `UserRound` dla Klienci i `UserCog` dla Pracownicy (różne ikony Lucide).

### 2.7 Dashboard Page — ZA CIĘŻKI

**Problem:** `page.tsx` dashboardu ma 76KB+ — to zbyt dużo dla jednego pliku. Implikuje brak code splitting i wolne ładowanie.

**Rekomendacja:**
- Rozbij na Server Components + Client Components z Suspense
- Każdy widget (stats, calendar preview, AI recommendations, quick actions) jako osobny komponent z własnym `loading.tsx`
- Lazy load sekcji poniżej fold

### 2.8 Formularz rezerwacji (Client Portal) — UX FLOW

**Problemy potencjalne (wymaga weryfikacji w kodzie):**
- Czy flow rezerwacji jest liniowy (wizard) czy single-page?
- Czy postęp jest widoczny (progress bar)?
- Czy walidacja jest inline czy po submit?

**Rekomendacja:**
Flow rezerwacji powinien być 4-krokowy wizard:
1. Wybór usługi → 2. Wybór pracownika + termin → 3. Dane kontaktowe → 4. Potwierdzenie + płatność
Z progress bar na górze, back button, i inline walidacją.

---

## 3. Dark Mode — Pełna Specyfikacja

### 3.1 Poprawione tokeny

```css
.dark {
  /* Background hierarchy: bg < sidebar < card */
  --background: oklch(0.14 0.02 50);      /* Najciemniejszy */
  --sidebar: oklch(0.11 0.02 50);         /* Ciemniejszy od bg */
  --card: oklch(0.18 0.025 50);           /* Jaśniejszy od bg */

  /* Text contrast */
  --foreground: oklch(0.95 0.01 70);      /* OK */
  --muted-foreground: oklch(0.68 0.02 55); /* Jaśniejszy +8% */

  /* Borders — wyraźniejsze */
  --border: oklch(0.95 0.01 70 / 15%);    /* Było 10% */
  --sidebar-border: oklch(0.95 0.01 70 / 12%);

  /* Primary — cieplejszy glow */
  --primary: oklch(0.72 0.10 55);         /* Jaśniejszy +2% */
  --ring: oklch(0.72 0.10 55 / 50%);     /* Mocniejszy ring */

  /* Chart — jaśniejsze dla czytelności */
  --chart-1: oklch(0.75 0.10 55);
  --chart-2: oklch(0.68 0.10 45);
  --chart-3: oklch(0.58 0.10 145);
  --chart-4: oklch(0.65 0.06 50);
  --chart-5: oklch(0.48 0.06 50);
}
```

### 3.2 Dark mode glass effect

```css
.dark .glass {
  background: oklch(0.14 0.02 50 / 85%);
  backdrop-filter: blur(16px);  /* Zwiększ blur */
  border: 1px solid oklch(0.95 0.01 70 / 8%);
}
```

### 3.3 Dark mode warm shadows → glow

```css
.dark {
  --shadow-warm-sm: 0 0 8px oklch(0.72 0.10 55 / 0.08);
  --shadow-warm-md: 0 0 16px oklch(0.72 0.10 55 / 0.10);
  --shadow-warm-lg: 0 0 24px oklch(0.72 0.10 55 / 0.12);
  --shadow-warm-xl: 0 0 40px oklch(0.72 0.10 55 / 0.15);
}
```

### 3.4 Elementy wymagające dark mode review

| Komponent | Problem | Fix |
|-----------|---------|-----|
| Landing hero blobs | `bg-primary/[0.04]` niewidoczne na ciemnym tle | Zwiększ do `bg-primary/[0.08]` w dark |
| Feature cards | `bg-card/50` → transparentność | `dark:bg-card/80` |
| Trust bar | `bg-muted/30` — brak wizualnego oddzielenia | `dark:bg-muted/50 dark:border-y-border/20` |
| Pricing cards | White overlays | Zmień na ciemne gradient overlays |
| Calendar event colors | Status colors (amber, blue, green) | Sprawdź kontrast na ciemnym tle |
| Hero text gradient | `.text-gradient-rose` — dark wariant istnieje ✓ | OK |
| Badge "PRO" | `variant="gold"` — sprawdzić dark czytelność | Może potrzebować jaśniejszego bg |

### 3.5 Testowanie dark mode

Przejdź **każdy** screen w obu motywach i sprawdź:
- [ ] Kontrast tekstu (minimum 4.5:1 dla normalnego, 3:1 dla dużego)
- [ ] Czytelność border/separator
- [ ] Ikony widoczne na ciemnym tle
- [ ] Wykresy i chart czytelne
- [ ] Forms — input fields widoczne
- [ ] Toasts/notifications czytelne
- [ ] Calendar — kolory statusów wizyt
- [ ] Empty states i error states

---

## 4. Plan implementacji (kolejność)

### Faza 1: Dark Mode & Accessibility (1-2 dni)
1. Popraw CSS tokeny dark mode w `globals.css`
2. Dodaj skip link w `layout.tsx`
3. Dodaj `:focus-visible` styles
4. Dodaj `prefers-reduced-motion` media query
5. Przejdź screen-by-screen i napraw dark mode issues
6. Usuń `disableTransitionOnChange` z ThemeProvider

### Faza 2: Mobile UX (1-2 dni)
7. Zmniejsz hero font size na mobile (`text-4xl`)
8. Zwiększ touch targets w sidebar (`min-h-[44px]`)
9. Rozważ bottom navigation bar dla mobile
10. Przetestuj responsive na 360px, 768px, 1024px

### Faza 3: UX Improvements (2-3 dni)
11. Stwórz `<EmptyState>` reużywalny komponent
12. Dodaj `loading.tsx` do kluczowych route groups
13. Pogrupuj sidebar navigation
14. Zmień ikonę Pracownicy na `UserCog`
15. Dodaj breadcrumbs w dashboard

### Faza 4: Performance & Polish (1-2 dni)
16. Rozbij dashboard page.tsx na mniejsze komponenty
17. Dodaj Suspense boundaries
18. Skeleton screens dla data-heavy widoków
19. Final QA — oba motywy, 3 breakpointy

---

## 5. Podsumowanie ocen

| Obszar | Przed | Po naprawach |
|--------|-------|-------------|
| System kolorów | 9/10 | 9/10 (zachować) |
| Typografia | 8/10 | 8/10 (zachować) |
| Dark mode | 6/10 | 9/10 (po naprawach) |
| Accessibility | 5/10 | 8/10 (skip link, focus, reduced motion) |
| Mobile UX | 7/10 | 8/10 (touch targets, hero size) |
| Empty/Loading states | 4/10 | 8/10 (nowe komponenty) |
| Navigation (sidebar) | 7/10 | 9/10 (grupowanie, breadcrumbs) |
| Dashboard performance | 5/10 | 8/10 (code splitting) |
| **Średnia** | **6.4/10** | **8.4/10** |

---

*Dokument wygenerowany na podstawie analizy kodu źródłowego My_Helper_2 (commit z marca 2026) i skilla UX/UI Designer.*
