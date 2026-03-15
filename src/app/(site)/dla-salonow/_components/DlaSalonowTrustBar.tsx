"use client";

const TRUST_STATS = [
  { value: "30+", label: "Funkcji" },
  { value: "AI", label: "Asystent glosowy" },
  { value: "24/7", label: "Rezerwacje online" },
  { value: "100%", label: "Polski produkt" },
] as const;

export function DlaSalonowTrustBar() {
  return (
    <section className="border-y bg-muted/30 dark:bg-muted/50 dark:border-y-border/20">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {TRUST_STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold text-primary">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
