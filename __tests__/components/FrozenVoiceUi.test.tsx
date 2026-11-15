/**
 * Głos (voiceAi) jest zamrożony w rejestrze — trasy /api/ai/voice/* zwracają
 * 404. Interfejs nie może więc pokazywać niczego, co je woła: mikrofonu
 * w polach notatek, przycisku „czytaj na głos”, pływającego mikrofonu ani
 * dyktowania w palecie poleceń. Kontrola: przy module włączonym w kontekście
 * (symulacja odmrożenia) elementy wracają.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { VoiceCommandButton } from "@/components/dashboard/voice-command-button";
import { ReadAloudButton } from "@/components/ui/read-aloud-button";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

const voice = vi.hoisted(() => ({
  startListening: vi.fn(),
  stopListening: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/hooks/use-voice-input", () => ({
  useVoiceInput: () => ({
    isListening: false,
    isProcessing: false,
    isSupported: true,
    startListening: voice.startListening,
    stopListening: voice.stopListening,
  }),
}));
vi.mock("@/hooks/use-text-to-speech", () => ({
  useTextToSpeech: () => ({
    speak: voice.speak,
    stop: voice.stop,
    isSpeaking: false,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => ({ isProPlan: true, loading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const THAWED: ModulesState = { ...DEFAULT_MODULES, voiceAi: true };

function withModules(ui: React.ReactNode, modules: ModulesState = DEFAULT_MODULES) {
  return render(<ModulesProvider modules={modules}>{ui}</ModulesProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VoiceTextarea", () => {
  it("głos zamrożony: zwykłe pole tekstowe bez mikrofonu, które przyjmuje notatkę", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    withModules(<VoiceTextarea aria-label="Notatki" onChange={onChange} />);

    const field = screen.getByRole("textbox", { name: "Notatki" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    await user.type(field, "Farba 6.0, 30 min");

    expect(field).toHaveValue("Farba 6.0, 30 min");
    expect(onChange).toHaveBeenCalled();
    expect(voice.startListening).not.toHaveBeenCalled();
  });

  it("kontrola: przy module głosu włączonym mikrofon wraca", () => {
    withModules(<VoiceTextarea aria-label="Notatki" />, THAWED);

    expect(screen.getByRole("textbox", { name: "Notatki" })).toBeInTheDocument();
    expect(screen.getByTitle("Nagrywaj glos")).toBeInTheDocument();
  });
});

describe("ReadAloudButton", () => {
  it("głos zamrożony: przycisk się nie renderuje", () => {
    const { container } = withModules(<ReadAloudButton text="Podsumowanie wizyty" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("kontrola: przy module głosu włączonym przycisk wraca", () => {
    withModules(<ReadAloudButton text="Podsumowanie wizyty" />, THAWED);

    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("VoiceCommandButton (pływający mikrofon w panelu)", () => {
  it("głos zamrożony: nic nie renderuje — ani przycisku, ani pustego kontenera", () => {
    const { container } = withModules(<VoiceCommandButton />);

    expect(container).toBeEmptyDOMElement();
  });

  it("kontrola: przy module głosu włączonym przycisk wraca", () => {
    withModules(<VoiceCommandButton />, THAWED);

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("nie rejestruje skrótu klawiszowego, który wołałby zamrożoną trasę", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/dashboard/voice-command-button.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/addEventListener|keydown|onKeyDown|useHotkeys/);
  });
});
