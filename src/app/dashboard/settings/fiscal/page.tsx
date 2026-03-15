"use client";

import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FiscalConnectionForm } from "./_components/fiscal-connection-form";
import { FiscalPrinterConfig } from "./_components/fiscal-printer-config";
import { FiscalReceiptConfig } from "./_components/fiscal-receipt-config";
import { FiscalTestSection } from "./_components/fiscal-test-section";
import { useFiscalSettings } from "./_hooks/use-fiscal-settings";

export default function FiscalSettingsPage() {
  const {
    loading,
    saving,
    testing,
    printing,
    settings,
    updateSetting,
    handleSave,
    handleTestConnection,
    handleTestPrint,
  } = useFiscalSettings();

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

      <FiscalConnectionForm
        settings={settings}
        onUpdateSetting={updateSetting}
      />

      <FiscalPrinterConfig
        settings={settings}
        onUpdateSetting={updateSetting}
      />

      <FiscalReceiptConfig
        settings={settings}
        onUpdateSetting={updateSetting}
      />

      <FiscalTestSection
        settings={settings}
        saving={saving}
        testing={testing}
        printing={printing}
        onTestConnection={handleTestConnection}
        onTestPrint={handleTestPrint}
        onSave={handleSave}
      />
    </div>
  );
}
