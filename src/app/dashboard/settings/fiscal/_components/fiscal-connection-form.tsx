"use client";

import {
  Settings,
  Printer,
  Wifi,
  Usb,
  Cable,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { POPULAR_PRINTERS } from "../_types";
import type { FiscalPrinterSettings } from "../_types";

// Map icon names to actual icon components
const CONNECTION_TYPES_WITH_ICONS = [
  { value: "network" as const, label: "Sieciowe (TCP/IP)", icon: Wifi, description: "Polaczenie przez siec lokalna" },
  { value: "usb" as const, label: "USB", icon: Usb, description: "Bezposrednie polaczenie USB" },
  { value: "serial" as const, label: "Port szeregowy (RS-232)", icon: Cable, description: "Polaczenie przez port COM" },
];

interface FiscalConnectionFormProps {
  settings: FiscalPrinterSettings;
  onUpdateSetting: <K extends keyof FiscalPrinterSettings>(key: K, value: FiscalPrinterSettings[K]) => void;
}

export function FiscalConnectionForm({
  settings,
  onUpdateSetting,
}: FiscalConnectionFormProps) {
  return (
    <>
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
            {CONNECTION_TYPES_WITH_ICONS.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => onUpdateSetting("connectionType", value)}
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
            onChange={(e) => onUpdateSetting("printerModel", e.target.value)}
            placeholder="np. Posnet Thermal HD"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background mb-3"
            data-testid="printer-model-input"
          />
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">Popularne modele:</span>
            {POPULAR_PRINTERS.map((model) => (
              <button
                key={model}
                onClick={() => onUpdateSetting("printerModel", model)}
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
    </>
  );
}
