"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Strefa ciszy wokół kodu, w modułach (wartość ze standardu QR). */
export const QR_MARGIN_MODULES = 4;

/** Bok pobieranego PNG w pikselach: ok. 8 cm przy 300 dpi, wystarcza też na Instagram. */
export const QR_PNG_SIZE_PX = 1024;

/** Poziom korekcji błędów M: ok. 15% modułów może być zabrudzone albo zasłonięte. */
const QR_ERROR_CORRECTION = "M";

/** 0 = biblioteka sama dobiera najmniejszy rozmiar kodu, który pomieści treść. */
const QR_AUTO_TYPE_NUMBER = 0;

/**
 * Po ilu ms zwalniamy adres pliku. Część przeglądarek zaczyna pobieranie
 * dopiero po zakończeniu obsługi kliknięcia, więc natychmiastowe zwolnienie
 * potrafi przerwać pobieranie.
 */
const OBJECT_URL_REVOKE_DELAY_MS = 1000;

const PNG_ERROR_MESSAGE = "Nie udało się przygotować obrazu PNG. Spróbuj ponownie albo pobierz SVG.";

/**
 * Macierz kodu QR razem ze strefą ciszy: `true` = ciemny moduł.
 * Treść kodu to dokładnie `text`, bez przycinania i dopisków.
 */
export function buildQrMatrix(text: string): boolean[][] {
  const qr = qrcode(QR_AUTO_TYPE_NUMBER, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QR_MARGIN_MODULES * 2;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const r = row - QR_MARGIN_MODULES;
      const c = col - QR_MARGIN_MODULES;
      return r >= 0 && r < count && c >= 0 && c < count && qr.isDark(r, c);
    })
  );
}

/** Ścieżka SVG z kwadratem 1×1 na każdy ciemny moduł (jednostka = moduł). */
function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((cells, row) => {
    cells.forEach((dark, col) => {
      if (dark) parts.push(`M${col} ${row}h1v1h-1z`);
    });
  });
  return parts.join("");
}

/** Samodzielny plik SVG: białe tło, czarne moduły, ostre krawędzie. */
export function buildQrSvg(matrix: boolean[][]): string {
  const size = matrix.length;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="${QR_PNG_SIZE_PX}" height="${QR_PNG_SIZE_PX}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/>` +
    `<path d="${qrPath(matrix)}" fill="#000000"/>` +
    `</svg>`
  );
}

export function qrFileName(slug: string, extension: "png" | "svg"): string {
  return `qr-${slug}.${extension}`;
}

/**
 * Rysuje macierz na płótnie `QR_PNG_SIZE_PX` × `QR_PNG_SIZE_PX`. Moduły mają
 * granice zaokrąglone do pełnych pikseli, więc krawędzie są ostre, a sąsiednie
 * moduły różnią się najwyżej o 1 px.
 */
function renderQrPng(matrix: boolean[][]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = QR_PNG_SIZE_PX;
    canvas.height = QR_PNG_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("canvas 2d niedostępny"));
      return;
    }
    const size = matrix.length;
    const edge = (i: number) => Math.round((i * QR_PNG_SIZE_PX) / size);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, QR_PNG_SIZE_PX, QR_PNG_SIZE_PX);
    ctx.fillStyle = "#000000";
    matrix.forEach((cells, row) => {
      cells.forEach((dark, col) => {
        if (!dark) return;
        const x = edge(col);
        const y = edge(row);
        ctx.fillRect(x, y, edge(col + 1) - x, edge(row + 1) - y);
      });
    });
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas nie zwrócił obrazu"));
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  // Firefox pobiera tylko z linku podpiętego do dokumentu.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
}

interface BookingLinkQrProps {
  /** Pełny link do rezerwacji — dokładnie ten napis trafia do kodu. */
  url: string;
  /** Końcówka adresu, do nazwy pobieranego pliku. */
  slug: string;
}

/**
 * Kod QR linku do rezerwacji: podgląd i pobranie PNG albo SVG. Wszystko
 * powstaje w przeglądarce, bez zapytań do serwera.
 */
export function BookingLinkQr({ url, slug }: BookingLinkQrProps) {
  const matrix = useMemo(() => {
    try {
      return buildQrMatrix(url);
    } catch {
      return null;
    }
  }, [url]);

  if (!matrix) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="booking-link-qr-error">
        Nie udało się przygotować kodu QR. Odśwież stronę.
      </p>
    );
  }

  const size = matrix.length;

  const handlePng = async () => {
    try {
      const blob = await renderQrPng(matrix);
      downloadBlob(blob, qrFileName(slug, "png"));
    } catch {
      toast.error(PNG_ERROR_MESSAGE);
    }
  };

  const handleSvg = () => {
    try {
      downloadBlob(new Blob([buildQrSvg(matrix)], { type: "image/svg+xml" }), qrFileName(slug, "svg"));
    } catch {
      toast.error("Nie udało się przygotować pliku SVG. Spróbuj ponownie.");
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center" data-testid="booking-link-qr">
      {/* Białe tło także w ciemnym motywie — czytniki potrzebują ciemnych modułów na jasnym tle. */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-40 w-40 shrink-0 rounded-md border bg-white"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Kod QR z linkiem ${url}`}
        data-testid="booking-link-qr-preview"
      >
        <path d={qrPath(matrix)} fill="black" />
      </svg>
      <div className="space-y-2">
        <Button type="button" onClick={handlePng} data-testid="booking-link-qr-png">
          <Download className="h-4 w-4 mr-2" />
          Pobierz kod QR
        </Button>
        <div>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={handleSvg}
            data-testid="booking-link-qr-svg"
          >
            Pobierz SVG (do drukarni)
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Wydrukuj i postaw przy recepcji albo dodaj do posta. Po zmianie adresu stary kod dalej działa.
        </p>
      </div>
    </div>
  );
}
