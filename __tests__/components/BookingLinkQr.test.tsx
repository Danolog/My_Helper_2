import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingLinkQr,
  buildQrMatrix,
  buildQrSvg,
  QR_MARGIN_MODULES,
  QR_PNG_SIZE_PX,
  qrFileName,
} from "@/app/dashboard/settings/booking-link/_components/BookingLinkQr";
import BookingLinkSettingsPage from "@/app/dashboard/settings/booking-link/page";
import { SALON_SLUG_MAX_LENGTH, salonShortUrl } from "@/lib/salon-slug";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

/** Moduły atrapy: szachownica, żeby podgląd i PNG miały co rysować. */
const FAKE_MODULE_COUNT = 21;
const addDataSpy = vi.fn();

function fakeQr() {
  return {
    addData: addDataSpy,
    make: vi.fn(),
    getModuleCount: () => FAKE_MODULE_COUNT,
    isDark: (row: number, col: number) => (row + col) % 2 === 0,
  };
}

// Testy UI używają atrapy biblioteki; test macierzy niżej bierze prawdziwą przez importActual.
vi.mock("qrcode-generator", () => ({
  default: vi.fn(() => fakeQr()),
}));

const SALON_ID = "salon-1";
const SLUG = "salon-anna";
const URL_FOR_COMPONENT = "https://example.test/s/salon-anna";

function stubSalonFetch(slug: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/salons/mine")) {
        return { json: async () => ({ success: true, salon: { id: SALON_ID, slug } }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
}

interface FakeCtx {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
}

/** Atrapa canvas: happy-dom nie rysuje, więc kontekst i toBlob podstawiamy. */
function stubCanvas({ context = true, blob = true }: { context?: boolean; blob?: boolean } = {}) {
  const ctx: FakeCtx = { fillStyle: "", fillRect: vi.fn() };
  const sizes: Array<{ width: number; height: number }> = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    sizes.push({ width: this.width, height: this.height });
    return (context ? ctx : null) as unknown as ReturnType<HTMLCanvasElement["getContext"]>;
  } as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type?: string) => {
    callback(blob ? new Blob(["png"], { type: type ?? "image/png" }) : null);
  });
  return { ctx, sizes };
}

/** Przechwytuje pobranie: nazwę pliku z linku i plik przekazany do createObjectURL. */
function captureDownloads() {
  const downloads: Array<{ fileName: string; href: string }> = [];
  const blobs: Blob[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ fileName: this.download, href: this.href });
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    blobs.push(value as Blob);
    return "blob:qr-test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { downloads, blobs };
}

describe("BookingLinkQr na stronie linku do rezerwacji", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("przy adresie pokazuje podgląd i oba przyciski, a do kodu trafia dokładnie shortUrl", async () => {
    stubSalonFetch(SLUG);
    render(<BookingLinkSettingsPage />);

    const expected = salonShortUrl(window.location.origin, SLUG);
    expect(await screen.findByTestId("booking-link-qr-png")).toHaveTextContent("Pobierz kod QR");
    expect(screen.getByTestId("booking-link-qr-svg")).toHaveTextContent("Pobierz SVG (do drukarni)");
    expect(screen.getByTestId("booking-link-url")).toHaveValue(expected);
    expect(screen.getByRole("img", { name: `Kod QR z linkiem ${expected}` })).toBeInTheDocument();
    expect(addDataSpy).toHaveBeenCalledWith(expected);
    expect(addDataSpy.mock.calls.every(([text]) => text === expected)).toBe(true);
    expect(screen.getByText(/Po zmianie adresu stary kod dalej działa\./)).toBeInTheDocument();
  });

  it("bez adresu salonu nie ma kodu ani przycisków pobrania", async () => {
    stubSalonFetch(null);
    render(<BookingLinkSettingsPage />);

    expect(await screen.findByText("Salon nie ma jeszcze adresu. Wpisz go poniżej i zapisz.")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-link-qr")).not.toBeInTheDocument();
    expect(screen.queryByTestId("booking-link-qr-png")).not.toBeInTheDocument();
    expect(screen.queryByTestId("booking-link-qr-svg")).not.toBeInTheDocument();
    expect(addDataSpy).not.toHaveBeenCalled();
  });
});

describe("BookingLinkQr pobieranie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("nazwy plików to qr-<slug>.png i qr-<slug>.svg", () => {
    expect(qrFileName(SLUG, "png")).toBe("qr-salon-anna.png");
    expect(qrFileName(SLUG, "svg")).toBe("qr-salon-anna.svg");
  });

  it("PNG: płótno 1024×1024, plik qr-<slug>.png typu image/png", async () => {
    const { ctx, sizes } = stubCanvas();
    const { downloads, blobs } = captureDownloads();
    render(<BookingLinkQr url={URL_FOR_COMPONENT} slug={SLUG} />);

    fireEvent.click(screen.getByTestId("booking-link-qr-png"));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.fileName).toBe("qr-salon-anna.png");
    expect(sizes).toEqual([{ width: QR_PNG_SIZE_PX, height: QR_PNG_SIZE_PX }]);
    expect(blobs[0]?.type).toBe("image/png");
    // Pierwsze wypełnienie to białe tło na całym płótnie, potem moduły.
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, QR_PNG_SIZE_PX, QR_PNG_SIZE_PX]);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("SVG: plik qr-<slug>.svg typu image/svg+xml", async () => {
    const { downloads, blobs } = captureDownloads();
    render(<BookingLinkQr url={URL_FOR_COMPONENT} slug={SLUG} />);

    fireEvent.click(screen.getByTestId("booking-link-qr-svg"));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.fileName).toBe("qr-salon-anna.svg");
    expect(blobs[0]?.type).toBe("image/svg+xml");
  });

  it("brak kontekstu canvas daje toast z błędem, a komponent zostaje na stronie", async () => {
    stubCanvas({ context: false });
    const { downloads } = captureDownloads();
    render(<BookingLinkQr url={URL_FOR_COMPONENT} slug={SLUG} />);

    fireEvent.click(screen.getByTestId("booking-link-qr-png"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(downloads).toHaveLength(0);
    expect(screen.getByTestId("booking-link-qr-png")).toBeInTheDocument();
    expect(screen.getByTestId("booking-link-qr-svg")).toBeInTheDocument();
  });

  it("canvas bez obrazu (toBlob zwraca null) daje toast z błędem", async () => {
    stubCanvas({ blob: false });
    const { downloads } = captureDownloads();
    render(<BookingLinkQr url={URL_FOR_COMPONENT} slug={SLUG} />);

    fireEvent.click(screen.getByTestId("booking-link-qr-png"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(downloads).toHaveLength(0);
    expect(screen.getByTestId("booking-link-qr-preview")).toBeInTheDocument();
  });

  it("błąd biblioteki przy budowie kodu pokazuje komunikat zamiast wywracać stronę", () => {
    vi.mocked(qrcode).mockImplementationOnce(() => {
      throw new Error("code length overflow");
    });
    render(<BookingLinkQr url={URL_FOR_COMPONENT} slug={SLUG} />);

    expect(screen.getByTestId("booking-link-qr-error")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-link-qr-png")).not.toBeInTheDocument();
  });

  it("SVG ma białe tło i viewBox o boku macierzy", () => {
    const matrix = [
      [true, false],
      [false, true],
    ];
    const svg = buildQrSvg(matrix);
    expect(svg).toContain('viewBox="0 0 2 2"');
    expect(svg).toContain('<rect width="2" height="2" fill="#ffffff"/>');
    expect(svg).toContain('d="M0 0h1v1h-1zM1 1h1v1h-1z"');
  });
});

describe("buildQrMatrix z prawdziwą biblioteką", () => {
  it("macierz to dokładnie kod QR (poziom M) napisu shortUrl ze strefą ciszy 4 moduły", async () => {
    const real = (await vi.importActual("qrcode-generator")) as { default: typeof qrcode };
    const realQrcode = real.default;
    vi.mocked(qrcode).mockImplementation(realQrcode);

    const shortUrl = salonShortUrl("https://myhelper.pl", SLUG);
    const matrix = buildQrMatrix(shortUrl);

    const reference = realQrcode(0, "M");
    reference.addData(shortUrl);
    reference.make();
    const count = reference.getModuleCount();

    expect(matrix).toHaveLength(count + QR_MARGIN_MODULES * 2);
    matrix.forEach((cells, row) => {
      expect(cells).toHaveLength(count + QR_MARGIN_MODULES * 2);
      cells.forEach((dark, col) => {
        const r = row - QR_MARGIN_MODULES;
        const c = col - QR_MARGIN_MODULES;
        const inside = r >= 0 && r < count && c >= 0 && c < count;
        expect(dark).toBe(inside ? reference.isDark(r, c) : false);
      });
    });

    // Inny napis (np. z ukośnikiem na końcu) daje inną macierz — kod nie jest „podobny”, tylko ten sam.
    expect(buildQrMatrix(`${shortUrl}/`)).not.toEqual(matrix);

    // Najdłuższy slug: moduł w podglądzie 160 px ma co najmniej 3 px.
    const longest = buildQrMatrix(salonShortUrl("https://myhelper.pl", "a".repeat(SALON_SLUG_MAX_LENGTH)));
    expect(160 / longest.length).toBeGreaterThanOrEqual(3);
  });
});
