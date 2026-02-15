"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Printer,
  ArrowLeft,
  Save,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Wifi,
  Usb,
  Cable,
  TestTube,
  FileText,
  Settings,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";

interface FiscalPrinterSettings {
  enabled: boolean;
  connectionType: "network" | "usb" | "serial";
  printerModel: string;
  ipAddress: string;
  port: number;
  serialPort: string;
  baudRate: number;
  autoprint: boolean;
  printCopy: boolean;
  nip: string;
  headerLine1: string;
  headerLine2: string;
  headerLine3: string;
  lastTestAt: string | null;
  lastTestResult: "success" | "failure" | null;
  lastTestError: string | null;
}

const CONNECTION_TYPES = [
  { value: "network", label: "Sieciowe (TCP/IP)", icon: Wifi, description: "Polaczenie przez siec lokalna" },
  { value: "usb", label: "USB", icon: Usb, description: "Bezposrednie polaczenie USB" },
  { value: "serial", label: "Port szeregowy (RS-232)", icon: Cable, description: "Polaczenie przez port COM" },
] as const;

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const POPULAR_PRINTERS = [
  "Posnet Thermal HD",
  "Posnet Thermal FV",
  "Novitus Bono E",
  "Novitus Deon E",
  "Elzab Mera+",
  "Elzab Zeta",
  "Emar Printo 57T",
  "Farex Perła E",
];

export default function FiscalSettingsPage() {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [settings, setSettings] = useState<FiscalPrinterSettings>({
    enabled: false,
    connectionType: "network",
    printerModel: "",
    ipAddress: "",
    port: 9100,
    serialPort: "",
    baudRate: 9600,
    autoprint: false,
    printCopy: false,
    nip: "",
    headerLine1: "",
    headerLine2: "",
    headerLine3: "",
    lastTestAt: null,
    lastTestResult: null,
    lastTestError: null,
  });

  // Fetch salon ID
  useEffect(() => {
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons");
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          const userId = session?.user?.id;
          const userSalon = userId
            ? data.data.find((s: { ownerId: string | null }) => s.ownerId === userId)
            : null;
          setSalonId(userSalon ? userSalon.id : data.data[0].id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch salon:", err);
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
  }, [session]);

  // Fetch fiscal settings
  const fetchSettings = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/fiscal-settings`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch fiscal settings:", err);
      toast.error("Nie mozna zaladowac ustawien drukarki fiskalnej");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    if (salonId) {
      fetchSettings();
    }
  }, [salonId, fetchSettings]);

  // Save settings
  const handleSave = async () => {
    if (!salonId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/fiscal-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia zapisane!");
        setSettings(data.data);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien");
      }
    } catch (err) {
      console.error("Failed to save fiscal settings:", err);
      toast.error("Blad zapisywania ustawien");
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    if (!salonId) return;

    // First save settings, then test
    setSaving(true);
    try {
      const saveRes = await fetch(`/api/salons/${salonId}/fiscal-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) {
        toast.error("Nie mozna zapisac ustawien przed testem");
        setSaving(false);
        return;
      }
    } catch {
      toast.error("Blad przy zapisywaniu ustawien");
      setSaving(false);
      return;
    }
    setSaving(false);

    setTesting(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/fiscal-settings/test-connection`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Polaczenie OK!");
        setSettings((prev) => ({
          ...prev,
          lastTestAt: data.data.testedAt,
          lastTestResult: "success",
          lastTestError: null,
        }));
      } else {
        toast.error(data.message || data.error || "Test nie powiodl sie");
        setSettings((prev) => ({
          ...prev,
          lastTestAt: new Date().toISOString(),
          lastTestResult: "failure",
          lastTestError: data.data?.testError || data.error || "Unknown error",
        }));
      }
    } catch (err) {
      console.error("Test connection error:", err);
      toast.error("Blad testu polaczenia");
    } finally {
      setTesting(false);
    }
  };

  // Test print
  const handleTestPrint = async () => {
    if (!salonId) return;
    setPrinting(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/fiscal-settings/test-print`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Testowy paragon wyslany!");
      } else {
        toast.error(data.error || "Nie udalo sie wydrukowac testu");
      }
    } catch (err) {
      console.error("Test print error:", err);
      toast.error("Blad wydruku testowego");
    } finally {
      setPrinting(false);
    }
  };

  const updateSetting = <K extends keyof FiscalPrinterSettings>(
    key: K,
    value: FiscalPrinterSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Ladowanie ustawien drukarki fiskalnej...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Drukarka fiskalna</h1>
          <p className="text-muted-foreground">
            Konfiguracja integracji z drukarka fiskalna / kasa fiskalna
          </p>
        </div>
      </div>

      {/* Enable/Disable Card */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.enabled ? (
                <ToggleRight className="w-8 h-8 text-green-600" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-gray-400" />
              )}
              <div>
                <div className="font-semibold text-lg" data-testid="fiscal-enabled-label">
                  Integracja z drukarka fiskalna
                </div>
                <div className="text-sm text-muted-foreground">
                  {settings.enabled
                    ? "Wlaczona - paragony beda drukowane automatycznie"
                    : "Wylaczona - brak wydruku fiskalnego"}
                </div>
              </div>
            </div>
            <Button
              variant={settings.enabled ? "default" : "outline"}
              onClick={() => updateSetting("enabled", !settings.enabled)}
              data-testid="fiscal-toggle-btn"
              className={
                settings.enabled
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }
            >
              {settings.enabled ? "Wlaczona" : "Wylaczona"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connection Type */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Typ polaczenia</CardTitle>
              <CardDescription>Wybierz sposob polaczenia z drukarka</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CONNECTION_TYPES.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => updateSetting("connectionType", value)}
                data-testid={`connection-type-${value}`}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  settings.connectionType === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-5 h-5 text-primary" />
                  <span className="font-medium text-sm">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Printer Model */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Printer className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Model drukarki</CardTitle>
              <CardDescription>Wybierz lub wpisz model drukarki fiskalnej</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <input
            type="text"
            value={settings.printerModel}
            onChange={(e) => updateSetting("printerModel", e.target.value)}
            placeholder="np. Posnet Thermal HD"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background mb-3"
            data-testid="printer-model-input"
          />
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">Popularne modele:</span>
            {POPULAR_PRINTERS.map((model) => (
              <button
                key={model}
                onClick={() => updateSetting("printerModel", model)}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  settings.printerModel === model
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary/30"
                }`}
              >
                {model}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Connection Settings */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Wifi className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Ustawienia polaczenia</CardTitle>
              <CardDescription>Parametry polaczenia z drukarka</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.connectionType === "network" && (
            <>
              <div>
                <label htmlFor="ip-address" className="block text-sm font-medium mb-1">
                  Adres IP drukarki
                </label>
                <input
                  id="ip-address"
                  type="text"
                  value={settings.ipAddress}
                  onChange={(e) => updateSetting("ipAddress", e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  data-testid="ip-address-input"
                />
              </div>
              <div>
                <label htmlFor="port" className="block text-sm font-medium mb-1">
                  Port
                </label>
                <input
                  id="port"
                  type="number"
                  value={settings.port}
                  onChange={(e) => updateSetting("port", parseInt(e.target.value) || 9100)}
                  min={1}
                  max={65535}
                  className="w-32 border rounded-md px-3 py-2 text-sm bg-background"
                  data-testid="port-input"
                />
                <span className="ml-2 text-xs text-muted-foreground">
                  Domyslnie: 9100
                </span>
              </div>
            </>
          )}

          {settings.connectionType === "serial" && (
            <>
              <div>
                <label htmlFor="serial-port" className="block text-sm font-medium mb-1">
                  Port szeregowy
                </label>
                <input
                  id="serial-port"
                  type="text"
                  value={settings.serialPort}
                  onChange={(e) => updateSetting("serialPort", e.target.value)}
                  placeholder="/dev/ttyUSB0 lub COM1"
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  data-testid="serial-port-input"
                />
              </div>
              <div>
                <label htmlFor="baud-rate" className="block text-sm font-medium mb-1">
                  Predkosc transmisji (Baud Rate)
                </label>
                <div className="flex gap-2">
                  {BAUD_RATES.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => updateSetting("baudRate", rate)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        settings.baudRate === rate
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-primary/30"
                      }`}
                    >
                      {rate}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {settings.connectionType === "usb" && (
            <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <p>
                Polaczenie USB jest wykrywane automatycznie. Upewnij sie, ze drukarka jest
                podlaczona kablem USB do komputera i wlaczona.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Configuration */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Konfiguracja paragonu</CardTitle>
              <CardDescription>Dane wyswietlane na paragonach fiskalnych</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="nip" className="block text-sm font-medium mb-1">
              NIP
            </label>
            <input
              id="nip"
              type="text"
              value={settings.nip}
              onChange={(e) => updateSetting("nip", e.target.value)}
              placeholder="123-456-78-90"
              className="w-48 border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="nip-input"
            />
          </div>
          <div>
            <label htmlFor="header1" className="block text-sm font-medium mb-1">
              Naglowek paragonu - linia 1
            </label>
            <input
              id="header1"
              type="text"
              value={settings.headerLine1}
              onChange={(e) => updateSetting("headerLine1", e.target.value)}
              placeholder="Nazwa firmy"
              maxLength={40}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="header-line1-input"
            />
          </div>
          <div>
            <label htmlFor="header2" className="block text-sm font-medium mb-1">
              Naglowek paragonu - linia 2
            </label>
            <input
              id="header2"
              type="text"
              value={settings.headerLine2}
              onChange={(e) => updateSetting("headerLine2", e.target.value)}
              placeholder="Adres"
              maxLength={40}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="header-line2-input"
            />
          </div>
          <div>
            <label htmlFor="header3" className="block text-sm font-medium mb-1">
              Naglowek paragonu - linia 3
            </label>
            <input
              id="header3"
              type="text"
              value={settings.headerLine3}
              onChange={(e) => updateSetting("headerLine3", e.target.value)}
              placeholder="Telefon / www"
              maxLength={40}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="header-line3-input"
            />
          </div>
        </CardContent>
      </Card>

      {/* Printing Options */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Opcje drukowania</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <div className="font-medium text-sm">Automatyczny wydruk</div>
              <div className="text-xs text-muted-foreground">
                Drukuj paragon automatycznie po zakonczeniu wizyty
              </div>
            </div>
            <Button
              variant={settings.autoprint ? "default" : "outline"}
              size="sm"
              onClick={() => updateSetting("autoprint", !settings.autoprint)}
              data-testid="autoprint-toggle-btn"
              className={
                settings.autoprint
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }
            >
              {settings.autoprint ? "Wlaczony" : "Wylaczony"}
            </Button>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <div className="font-medium text-sm">Kopia paragonu</div>
              <div className="text-xs text-muted-foreground">
                Drukuj dodatkowa kopie paragonu dla salonu
              </div>
            </div>
            <Button
              variant={settings.printCopy ? "default" : "outline"}
              size="sm"
              onClick={() => updateSetting("printCopy", !settings.printCopy)}
              data-testid="print-copy-toggle-btn"
              className={
                settings.printCopy
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }
            >
              {settings.printCopy ? "Wlaczona" : "Wylaczona"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connection Test Card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <TestTube className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Test polaczenia</CardTitle>
              <CardDescription>Sprawdz polaczenie z drukarka i wydrukuj testowy paragon</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Last test result */}
          {settings.lastTestAt && (
            <div
              className={`flex items-start gap-3 p-4 rounded-lg mb-4 ${
                settings.lastTestResult === "success"
                  ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
              }`}
              data-testid="last-test-result"
            >
              {settings.lastTestResult === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">
                    {settings.lastTestResult === "success"
                      ? "Polaczenie aktywne"
                      : "Blad polaczenia"}
                  </span>
                  <Badge
                    variant={settings.lastTestResult === "success" ? "default" : "destructive"}
                    className={
                      settings.lastTestResult === "success"
                        ? "bg-green-100 text-green-800 hover:bg-green-100 border-green-200"
                        : ""
                    }
                  >
                    {settings.lastTestResult === "success" ? "OK" : "Blad"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Ostatni test: {new Date(settings.lastTestAt).toLocaleString("pl-PL")}
                </p>
                {settings.lastTestError && (
                  <div className="flex items-center gap-1 mt-2 text-sm text-red-600">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span>{settings.lastTestError}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Test buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleTestConnection}
              disabled={testing || saving}
              variant="outline"
              data-testid="test-connection-btn"
            >
              {testing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Testowanie...
                </>
              ) : (
                <>
                  <Wifi className="h-4 w-4 mr-2" />
                  Testuj polaczenie
                </>
              )}
            </Button>
            <Button
              onClick={handleTestPrint}
              disabled={printing || settings.lastTestResult !== "success"}
              variant="outline"
              data-testid="test-print-btn"
            >
              {printing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Drukowanie...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Wydrukuj testowy paragon
                </>
              )}
            </Button>
            {settings.lastTestResult !== "success" && !settings.lastTestAt && (
              <span className="text-xs text-muted-foreground self-center">
                Najpierw przetestuj polaczenie, aby moc wydrukowac testowy paragon
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center gap-3 mb-8">
        <Button
          onClick={handleSave}
          disabled={saving}
          size="lg"
          data-testid="save-fiscal-settings-btn"
        >
          {saving ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Zapisywanie...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Zapisz ustawienia
            </>
          )}
        </Button>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informacje o integracji fiskalnej</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Integracja z drukarka fiskalna wymaga:
            </p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Drukarka fiskalna podlaczona do sieci lokalnej lub bezposrednio do komputera</li>
              <li>Poprawna konfiguracja polaczenia (adres IP/port lub port COM)</li>
              <li>Uzupelniony NIP firmy w naglowku paragonu</li>
              <li>Pomyslny test polaczenia</li>
            </ol>
            <p className="mt-3">
              <strong>Wspierane drukarki:</strong> Posnet, Novitus, Elzab, Emar, Farex i inne
              drukarki fiskalne zgodne z polskim prawem fiskalnym.
            </p>
            <p>
              <strong>Uwaga:</strong> W srodowisku webowym, drukarka fiskalna wymaga
              lokalnego agenta/bridge do komunikacji. Skontaktuj sie z supportem, aby
              uzyskac instrukcje konfiguracji agenta na stanowisku kasowym.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
