import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ModuleGate } from "@/components/dashboard/module-gate";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import {
  DEFAULT_MODULES,
  MODULE_DISABLED_MESSAGE,
  MODULES,
  TOGGLEABLE_MODULES,
  type ModulesState,
} from "@/lib/features";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderGate(module: Parameters<typeof ModuleGate>[0]["module"], state?: ModulesState) {
  return render(
    <ModulesProvider modules={state ?? DEFAULT_MODULES}>
      <ModuleGate module={module}>
        <p>tresc strony</p>
      </ModuleGate>
    </ModulesProvider>
  );
}

const FROZEN = MODULES.filter((m) => m.hardOff);

describe("ModuleGate", () => {
  it.each(FROZEN.map((m) => m.key))(
    "moduł zamrożony %s: komunikat „obecnie niedostępna” i powrót do pulpitu",
    (key) => {
      renderGate(key);

      expect(screen.queryByText("tresc strony")).not.toBeInTheDocument();
      expect(screen.getByText(MODULE_DISABLED_MESSAGE)).toBeInTheDocument();

      const back = screen.getByRole("link", { name: "Wróć do pulpitu" });
      expect(back).toHaveAttribute("href", "/dashboard");

      // Zamrożonej funkcji nie obiecujemy i nie da się jej włączyć w ustawieniach.
      expect(document.body.textContent).not.toMatch(/wkr[óo]tce/i);
      expect(
        screen.queryByRole("link", { name: "Przejdź do ustawień modułów" })
      ).not.toBeInTheDocument();
    }
  );

  it("moduł zamrożony pozostaje zablokowany nawet przy stanie true w kontekście", () => {
    // Stan z kontekstu pochodzi z resolveModules (zawsze false dla hardOff);
    // bramka dodatkowo sama pyta rejestr.
    renderGate("invoices", { ...DEFAULT_MODULES, invoices: true });

    expect(screen.queryByText("tresc strony")).not.toBeInTheDocument();
    expect(screen.getByText(MODULE_DISABLED_MESSAGE)).toBeInTheDocument();
  });

  it.each(TOGGLEABLE_MODULES.map((m) => m.key))(
    "moduł przełączalny %s wyłączony: zachęta do włączenia w ustawieniach",
    (key) => {
      renderGate(key);

      expect(screen.queryByText("tresc strony")).not.toBeInTheDocument();
      expect(
        screen.getByText("Włącz go w ustawieniach, aby korzystać z tej sekcji.")
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Przejdź do ustawień modułów" })
      ).toHaveAttribute("href", "/dashboard/settings/modules");
      expect(screen.queryByText(MODULE_DISABLED_MESSAGE)).not.toBeInTheDocument();
    }
  );

  it("moduł przełączalny włączony: pokazuje treść strony", () => {
    renderGate("products", { ...DEFAULT_MODULES, products: true });

    expect(screen.getByText("tresc strony")).toBeInTheDocument();
  });
});
