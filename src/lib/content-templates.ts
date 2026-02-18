/**
 * Static content templates for the content generator.
 *
 * These are pre-built configuration presets that allow salon owners to quickly
 * generate social media posts and newsletters without manually configuring
 * every field. Each template targets a common salon marketing scenario.
 */

export type ContentTemplateCategory = "social" | "newsletter";

export interface SocialPreset {
  platform: "instagram" | "facebook" | "tiktok";
  postType: string;
  tone: string;
  context: string;
  includeEmoji: boolean;
  includeHashtags: boolean;
}

export interface NewsletterPreset {
  topic: string;
  goals: string;
  tone: string;
  length: string;
  includeCallToAction: boolean;
}

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  category: ContentTemplateCategory;
  icon: string;
  socialPreset?: SocialPreset;
  newsletterPreset?: NewsletterPreset;
}

// ---------------------------------------------------------------------------
// Social media templates
// ---------------------------------------------------------------------------

const socialTemplates: ContentTemplate[] = [
  {
    id: "social-weekend-promo",
    name: "Promocja weekendowa",
    description:
      "Post promujacy weekendowa oferte specjalna na Instagramie w swobodnym tonie",
    category: "social",
    icon: "\uD83C\uDF89",
    socialPreset: {
      platform: "instagram",
      postType: "promotion",
      tone: "casual",
      context:
        "Weekendowa promocja w salonie - rabaty na wybrane uslugi, idealna okazja do odwiedzenia nas w weekend",
      includeEmoji: true,
      includeHashtags: true,
    },
  },
  {
    id: "social-client-transformation",
    name: "Metamorfoza klienta",
    description:
      "Post pokazujacy efekty pracy (przed i po) w profesjonalnym tonie",
    category: "social",
    icon: "\u2728",
    socialPreset: {
      platform: "instagram",
      postType: "client_transformation",
      tone: "professional",
      context:
        "Metamorfoza klientki - pokazanie efektow zabiegow, profesjonalne podejscie i widoczne rezultaty",
      includeEmoji: true,
      includeHashtags: true,
    },
  },
  {
    id: "social-seasonal-offer",
    name: "Sezonowa oferta",
    description: "Post z sezonowa oferta na Facebooku w luksusowym tonie",
    category: "social",
    icon: "\uD83C\uDF3F",
    socialPreset: {
      platform: "facebook",
      postType: "seasonal",
      tone: "luxurious",
      context:
        "Sezonowa oferta specjalna dopasowana do aktualnej pory roku - ekskluzywne zabiegi w atrakcyjnej cenie",
      includeEmoji: true,
      includeHashtags: true,
    },
  },
  {
    id: "social-care-tips",
    name: "Porady pielegnacyjne",
    description:
      "Post edukacyjny z poradami dotyczacymi pielegnacji na Instagramie",
    category: "social",
    icon: "\uD83D\uDCA1",
    socialPreset: {
      platform: "instagram",
      postType: "tips_and_tricks",
      tone: "educational",
      context:
        "Profesjonalne porady pielegnacyjne od ekspertow z naszego salonu - wskazowki do codziennej pielegnacji",
      includeEmoji: true,
      includeHashtags: true,
    },
  },
  {
    id: "social-behind-scenes",
    name: "Za kulisami salonu",
    description:
      "Zabawny post pokazujacy codziennosc w salonie na TikToku",
    category: "social",
    icon: "\uD83C\uDFAC",
    socialPreset: {
      platform: "tiktok",
      postType: "behind_the_scenes",
      tone: "fun",
      context:
        "Zakulisowe momenty z zycia salonu - zabawne sytuacje, praca zespolu i codzienna energia naszego miejsca",
      includeEmoji: true,
      includeHashtags: true,
    },
  },
  {
    id: "social-new-service",
    name: "Nowa usluga w ofercie",
    description:
      "Post o nowej usludze w profesjonalnym tonie na Facebooku",
    category: "social",
    icon: "\uD83C\uDD95",
    socialPreset: {
      platform: "facebook",
      postType: "service_highlight",
      tone: "professional",
      context:
        "Prezentacja nowej uslugi w ofercie salonu - opis zabiegu, jego zalet i korzysci dla klientow",
      includeEmoji: true,
      includeHashtags: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Newsletter templates
// ---------------------------------------------------------------------------

const newsletterTemplates: ContentTemplate[] = [
  {
    id: "newsletter-monthly-promo",
    name: "Promocja miesiaca",
    description:
      "Newsletter z miesieczna promocja i oferta specjalna dla stalych klientow",
    category: "newsletter",
    icon: "\uD83C\uDF1F",
    newsletterPreset: {
      topic:
        "Miesieczna promocja w naszym salonie - specjalne rabaty na wybrane zabiegi i uslugi",
      goals: "promotion",
      tone: "casual",
      length: "medium",
      includeCallToAction: true,
    },
  },
  {
    id: "newsletter-reactivation",
    name: "Reaktywacja klientow",
    description:
      "Newsletter zachecajacy nieaktywnych klientow do powrotu do salonu",
    category: "newsletter",
    icon: "\uD83D\uDC8C",
    newsletterPreset: {
      topic:
        "Tesknilismy za Toba! Specjalna oferta powrotna dla naszych klientow - zapraszamy ponownie",
      goals: "reactivation",
      tone: "casual",
      length: "short",
      includeCallToAction: true,
    },
  },
  {
    id: "newsletter-salon-news",
    name: "Nowosci w salonie",
    description:
      "Newsletter z najnowszymi informacjami o salonie, nowymi uslugami i zmianami",
    category: "newsletter",
    icon: "\uD83D\uDCF0",
    newsletterPreset: {
      topic:
        "Nowosci w naszym salonie - nowe uslugi, nowi specjalisci i wazne zmiany",
      goals: "news",
      tone: "professional",
      length: "medium",
      includeCallToAction: true,
    },
  },
  {
    id: "newsletter-seasonal-tips",
    name: "Porady sezonowe",
    description:
      "Newsletter z poradami pielegnacyjnymi dopasowanymi do pory roku",
    category: "newsletter",
    icon: "\uD83C\uDF42",
    newsletterPreset: {
      topic:
        "Sezonowe porady pielegnacyjne od naszych ekspertow - jak dbac o siebie w aktualnej porze roku",
      goals: "tips",
      tone: "educational",
      length: "long",
      includeCallToAction: true,
    },
  },
  {
    id: "newsletter-loyalty-program",
    name: "Program lojalnosciowy",
    description:
      "Newsletter promujacy program lojalnosciowy i nagrody dla stalych klientow",
    category: "newsletter",
    icon: "\uD83C\uDFC6",
    newsletterPreset: {
      topic:
        "Nasz program lojalnosciowy - zbieraj punkty, zdobywaj nagrody i korzystaj z ekskluzywnych rabatow",
      goals: "loyalty",
      tone: "fun",
      length: "medium",
      includeCallToAction: true,
    },
  },
  {
    id: "newsletter-event-invitation",
    name: "Zaproszenie na wydarzenie",
    description:
      "Newsletter z zaproszeniem na specjalne wydarzenie w salonie",
    category: "newsletter",
    icon: "\uD83C\uDF88",
    newsletterPreset: {
      topic:
        "Zaproszenie na specjalne wydarzenie w naszym salonie - dzien otwarty, warsztaty lub pokaz",
      goals: "seasonal",
      tone: "luxurious",
      length: "medium",
      includeCallToAction: true,
    },
  },
];

// ---------------------------------------------------------------------------
// Combined list and helper utilities
// ---------------------------------------------------------------------------

export const contentTemplates: ContentTemplate[] = [
  ...socialTemplates,
  ...newsletterTemplates,
];

/**
 * Look up a single template by its unique id. Returns undefined when
 * no template matches so the caller can handle the missing-template
 * case explicitly.
 */
export function getTemplateById(
  id: string
): ContentTemplate | undefined {
  return contentTemplates.find((t) => t.id === id);
}

/**
 * Return all templates that belong to the given category.
 */
export function getTemplatesByCategory(
  category: ContentTemplateCategory
): ContentTemplate[] {
  return contentTemplates.filter((t) => t.category === category);
}
