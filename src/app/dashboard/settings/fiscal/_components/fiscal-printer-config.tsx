"use client";

import { Wifi } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BAUD_RATES } from "../_types";
import type { FiscalPrinterSettings } from "../_types";

interface FiscalPrinterConfigProps {
  settings: FiscalPrinterSettings;
  onUpdateSetting: <K extends keyof FiscalPrinterSettings>(key: K, value: FiscalPrinterSettings[K]) => void;
}

export function FiscalPrinterConfig({
  settings,
  onUpdateSetting,
}: FiscalPrinterConfigProps) {
  return (
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
                onChange={(e) => onUpdateSetting("ipAddress", e.target.value)}
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
                onChange={(e) => onUpdateSetting("port", parseInt(e.target.value) || 9100)}
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
                onChange={(e) => onUpdateSetting("serialPort", e.target.value)}
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
                    onClick={() => onUpdateSetting("baudRate", rate)}
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
  );
}
