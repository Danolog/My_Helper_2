"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, RefreshCw, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";

interface SalonData {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
}

const INDUSTRY_TYPES = [
  { value: "hair_salon", label: "Salon fryzjerski" },
  { value: "beauty_salon", label: "Salon kosmetyczny" },
  { value: "nails", label: "Salon paznokci" },
  { value: "barbershop", label: "Barber shop" },
  { value: "spa", label: "SPA & Wellness" },
  { value: "medical", label: "Gabinet medyczny" },
] as const;

export default function SalonSettingsPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [salon, setSalon] = useState<SalonData | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [industryType, setIndustryType] = useState("");

  useEffect(() => {
    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine");
        const data = await res.json();
        if (data.success && data.salon) {
          setSalon(data.salon);
          setName(data.salon.name || "");
          setPhone(data.salon.phone || "");
          setEmail(data.salon.email || "");
          setAddress(data.salon.address || "");
          setIndustryType(data.salon.industryType || "");
        }
      } catch (err) {
        console.error("Failed to fetch salon:", err);
        toast.error("Nie mozna zaladowac danych salonu");
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      fetchSalon();
    }
  }, [session]);

  const handleSave = async () => {
    if (!salon) return;
    if (!name.trim()) {
      toast.error("Nazwa salonu jest wymagana");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/salons/${salon.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          industryType: industryType || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Dane salonu zapisane!");
        setSalon(data.data);
      } else {
        toast.error(data.error || "Blad zapisywania danych");
      }
    } catch (err) {
      console.error("Failed to save salon:", err);
      toast.error("Blad zapisywania danych");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Ladowanie danych salonu...</span>
        </div>
      </div>
    );
  }

  if (!salon) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <Building2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">Nie znaleziono salonu</p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href="/dashboard">Powrot do dashboardu</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Dane salonu</h1>
          <p className="text-muted-foreground">
            Podstawowe informacje o Twoim salonie
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Informacje podstawowe</CardTitle>
              <CardDescription>Nazwa, kontakt i adres salonu</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="salon-name">Nazwa salonu *</Label>
            <Input
              id="salon-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Salon Piękności Anna"
              maxLength={100}
            />
          </div>

          <div>
            <Label htmlFor="salon-phone">Telefon</Label>
            <Input
              id="salon-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="np. +48 123 456 789"
              maxLength={20}
            />
          </div>

          <div>
            <Label htmlFor="salon-email">Email kontaktowy</Label>
            <Input
              id="salon-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="np. kontakt@salon.pl"
              maxLength={100}
            />
          </div>

          <div>
            <Label htmlFor="salon-address">Adres</Label>
            <Input
              id="salon-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="np. ul. Kwiatowa 15, 00-001 Warszawa"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="salon-industry">Typ dzialalnosci</Label>
            <Select value={industryType} onValueChange={setIndustryType}>
              <SelectTrigger id="salon-industry">
                <SelectValue placeholder="Wybierz typ" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRY_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Zapisywanie...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Zapisz dane salonu
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
