"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Lock,
  Users,
  Plus,
  Phone,
  Mail,
  Search,
  UserPlus,
  StickyNote,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface Client {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  allergies: string | null;
  favoriteEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ClientsPage() {
  const { data: session, isPending } = useSession();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Form state
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await fetchClients();
      setLoading(false);
    }
    loadData();
  }, [fetchClients]);

  const resetForm = () => {
    setFormFirstName("");
    setFormLastName("");
    setFormPhone("");
    setFormEmail("");
    setFormNotes("");
  };

  const handleSaveClient = async () => {
    if (!formFirstName.trim()) {
      toast.error("Imie jest wymagane");
      return;
    }
    if (!formLastName.trim()) {
      toast.error("Nazwisko jest wymagane");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: DEMO_SALON_ID,
          firstName: formFirstName.trim(),
          lastName: formLastName.trim(),
          phone: formPhone.trim() || null,
          email: formEmail.trim() || null,
          notes: formNotes.trim() || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          `Klient "${formFirstName.trim()} ${formLastName.trim()}" zostal dodany`
        );
        resetForm();
        setDialogOpen(false);
        await fetchClients();
      } else {
        toast.error(data.error || "Nie udalo sie dodac klienta");
      }
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("Blad podczas zapisywania klienta");
    } finally {
      setSaving(false);
    }
  };

  // Filter clients by search query
  const filteredClients = clients.filter((client) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      client.firstName.toLowerCase().includes(query) ||
      client.lastName.toLowerCase().includes(query) ||
      (client.phone && client.phone.toLowerCase().includes(query)) ||
      (client.email && client.email.toLowerCase().includes(query))
    );
  });

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
            Musisz sie zalogowac, aby zarzadzac klientami
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Klienci</h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj baza klientow salonu
            </p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-client-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj klienta
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Dodaj nowego klienta</DialogTitle>
              <DialogDescription>
                Wypelnij formularz, aby dodac nowego klienta do bazy salonu.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="client-first-name">Imie *</Label>
                  <Input
                    id="client-first-name"
                    placeholder="np. Jan"
                    value={formFirstName}
                    onChange={(e) => setFormFirstName(e.target.value)}
                    data-testid="client-first-name-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="client-last-name">Nazwisko *</Label>
                  <Input
                    id="client-last-name"
                    placeholder="np. Kowalski"
                    value={formLastName}
                    onChange={(e) => setFormLastName(e.target.value)}
                    data-testid="client-last-name-input"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-phone">Numer telefonu</Label>
                <Input
                  id="client-phone"
                  type="tel"
                  placeholder="np. +48 600 123 456"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  data-testid="client-phone-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-email">Adres email</Label>
                <Input
                  id="client-email"
                  type="email"
                  placeholder="np. jan.kowalski@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  data-testid="client-email-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-notes">Notatki</Label>
                <Textarea
                  id="client-notes"
                  placeholder="Dodatkowe informacje o kliencie..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={3}
                  data-testid="client-notes-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveClient}
                disabled={saving}
                data-testid="save-client-btn"
              >
                {saving ? "Zapisywanie..." : "Zapisz klienta"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Szukaj klienta po imieniu, nazwisku, telefonie lub emailu..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
          data-testid="client-search-input"
        />
      </div>

      {/* Clients list */}
      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserPlus className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Brak klientow. Dodaj pierwszego klienta, aby rozpoczac.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              data-testid="empty-state-add-client-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj klienta
            </Button>
          </CardContent>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nie znaleziono klientow pasujacych do &quot;{searchQuery}&quot;
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2">
            {filteredClients.length === clients.length
              ? `Liczba klientow: ${clients.length}`
              : `Wyniki wyszukiwania: ${filteredClients.length} z ${clients.length}`}
          </p>
          {filteredClients.map((client) => {
            const clientAllergies = client.allergies
              ? client.allergies
                  .split(",")
                  .map((a) => a.trim())
                  .filter((a) => a.length > 0)
              : [];
            const hasAllergies = clientAllergies.length > 0;

            return (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.id}`}
                className="block"
                data-testid={`client-link-${client.id}`}
              >
                <Card
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  data-testid={`client-card-${client.id}`}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-base" data-testid={`client-name-${client.id}`}>
                          {client.firstName} {client.lastName}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          Klient
                        </Badge>
                        {hasAllergies && (
                          <AlertTriangle
                            className="h-4 w-4 text-orange-500"
                            data-testid={`client-allergy-icon-${client.id}`}
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        {client.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {client.phone}
                          </span>
                        )}
                        {client.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {client.email}
                          </span>
                        )}
                        {client.notes && (
                          <span className="flex items-center gap-1">
                            <StickyNote className="h-3.5 w-3.5" />
                            {client.notes.length > 50
                              ? client.notes.substring(0, 50) + "..."
                              : client.notes}
                          </span>
                        )}
                      </div>
                      {hasAllergies && (
                        <div
                          className="flex flex-wrap items-center gap-1.5 mt-2"
                          data-testid={`client-allergies-${client.id}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          {clientAllergies.map((allergy, idx) => (
                            <Badge
                              key={`${allergy}-${idx}`}
                              variant="destructive"
                              className="text-xs"
                            >
                              {allergy}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
