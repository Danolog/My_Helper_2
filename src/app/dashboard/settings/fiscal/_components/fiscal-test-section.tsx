"use client";

import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Wifi,
  TestTube,
  FileText,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FiscalPrinterSettings } from "../_types";

interface FiscalTestSectionProps {
  settings: FiscalPrinterSettings;
  saving: boolean;
  testing: boolean;
  printing: boolean;
  onTestConnection: () => void;
  onTestPrint: () => void;
  onSave: () => void;
}

export function FiscalTestSection({
  settings,
  saving,
  testing,
  printing,
  onTestConnection,
  onTestPrint,
  onSave,
}: FiscalTestSectionProps) {
  return (
    <>
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
              onClick={onTestConnection}
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
              onClick={onTestPrint}
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
          onClick={onSave}
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
    </>
  );
}
