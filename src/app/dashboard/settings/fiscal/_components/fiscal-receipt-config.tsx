"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FiscalPrinterSettings } from "../_types";

interface FiscalReceiptConfigProps {
  settings: FiscalPrinterSettings;
  onUpdateSetting: <K extends keyof FiscalPrinterSettings>(key: K, value: FiscalPrinterSettings[K]) => void;
}

export function FiscalReceiptConfig({
  settings,
  onUpdateSetting,
}: FiscalReceiptConfigProps) {
  return (
    <>
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
              onChange={(e) => onUpdateSetting("nip", e.target.value)}
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
              onChange={(e) => onUpdateSetting("headerLine1", e.target.value)}
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
              onChange={(e) => onUpdateSetting("headerLine2", e.target.value)}
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
              onChange={(e) => onUpdateSetting("headerLine3", e.target.value)}
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
              onClick={() => onUpdateSetting("autoprint", !settings.autoprint)}
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
              onClick={() => onUpdateSetting("printCopy", !settings.printCopy)}
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
    </>
  );
}
