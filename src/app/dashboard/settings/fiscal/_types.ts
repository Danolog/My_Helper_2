export interface FiscalPrinterSettings {
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

export const CONNECTION_TYPES = [
  { value: "network", label: "Sieciowe (TCP/IP)", icon: "Wifi" as const, description: "Polaczenie przez siec lokalna" },
  { value: "usb", label: "USB", icon: "Usb" as const, description: "Bezposrednie polaczenie USB" },
  { value: "serial", label: "Port szeregowy (RS-232)", icon: "Cable" as const, description: "Polaczenie przez port COM" },
] as const;

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;

export const POPULAR_PRINTERS = [
  "Posnet Thermal HD",
  "Posnet Thermal FV",
  "Novitus Bono E",
  "Novitus Deon E",
  "Elzab Mera+",
  "Elzab Zeta",
  "Emar Printo 57T",
  "Farex Perla E",
] as const;
