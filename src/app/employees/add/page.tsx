"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Lock, UserPlus, Palette } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

// Demo salon ID - in production this would come from user's session
const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

// Employee color palette (same as API)
const EMPLOYEE_COLORS = [
  { hex: "#3b82f6", name: "Niebieski" },
  { hex: "#10b981", name: "Szmaragdowy" },
  { hex: "#f59e0b", name: "Bursztynowy" },
  { hex: "#ef4444", name: "Czerwony" },
  { hex: "#8b5cf6", name: "Fioletowy" },
  { hex: "#ec4899", name: "Rozowy" },
  { hex: "#06b6d4", name: "Turkusowy" },
  { hex: "#f97316", name: "Pomaranczowy" },
  { hex: "#84cc16", name: "Limonkowy" },
  { hex: "#6366f1", name: "Indygo" },
  { hex: "#14b8a6", name: "Morski" },
  { hex: "#a855f7", name: "Purpurowy" },
];

export default function AddEmployeePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedColor, setAssignedColor] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "employee",
  });

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!formData.firstName.trim()) {
      errors.firstName = "Imie jest wymagane";
    }
    if (!formData.lastName.trim()) {
      errors.lastName = "Nazwisko jest wymagane";
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = "Wprowadz poprawny adres email";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Wypelnij wymagane pola");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/employees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          salonId: DEMO_SALON_ID,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email || null,
          phone: formData.phone || null,
          role: formData.role,
          // Color is automatically assigned by the API
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Show the assigned color
        const assignedColor = data.data.color;
        setAssignedColor(assignedColor);

        const colorName = EMPLOYEE_COLORS.find(c => c.hex === assignedColor)?.name || "Niestandardowy";

        toast.success("Pracownik zostal dodany!", {
          description: `${formData.firstName} ${formData.lastName} - przypisano kolor: ${colorName}`,
        });

        // Redirect to calendar after a short delay
        setTimeout(() => {
          router.push("/calendar/all");
        }, 2000);
      } else {
        toast.error("Nie udalo sie dodac pracownika", {
          description: data.error,
        });
      }
    } catch (error) {
      console.error("Failed to add employee:", error);
      toast.error("Wystapil blad podczas dodawania pracownika");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby dodac pracownika
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Back link */}
      <Link href="/calendar/all" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Powrot do kalendarza
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <UserPlus className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>Dodaj pracownika</CardTitle>
              <CardDescription>
                Kolor zostanie przypisany automatycznie z palety dostepnych kolorow.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Imie *</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  placeholder="Jan"
                  required
                  aria-invalid={!!fieldErrors.firstName}
                />
                {fieldErrors.firstName && (
                  <p className="text-sm text-destructive">{fieldErrors.firstName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nazwisko *</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  placeholder="Kowalski"
                  required
                  aria-invalid={!!fieldErrors.lastName}
                />
                {fieldErrors.lastName && (
                  <p className="text-sm text-destructive">{fieldErrors.lastName}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="jan.kowalski@example.com"
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+48 123 456 789"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Rola</Label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="employee">Pracownik</option>
                <option value="owner">Wlasciciel</option>
                <option value="reception">Recepcja</option>
              </select>
            </div>

            {/* Color palette preview */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Dostepne kolory (automatyczne przypisanie)
              </Label>
              <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg border">
                {EMPLOYEE_COLORS.map((color) => (
                  <div
                    key={color.hex}
                    className={`w-6 h-6 rounded-full border-2 ${
                      assignedColor === color.hex ? "border-foreground ring-2 ring-primary" : "border-white"
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                System automatycznie przypisze pierwszy nieuzywany kolor z palety.
              </p>
            </div>

            {/* Show assigned color after success */}
            {assignedColor && (
              <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <div
                  className="w-8 h-8 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: assignedColor }}
                />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Kolor przypisany!
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {EMPLOYEE_COLORS.find(c => c.hex === assignedColor)?.name || assignedColor}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={isSubmitting} className="flex-1">
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Dodawanie...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Dodaj pracownika
                  </>
                )}
              </Button>
              <Link href="/calendar/all">
                <Button type="button" variant="outline">
                  Anuluj
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
