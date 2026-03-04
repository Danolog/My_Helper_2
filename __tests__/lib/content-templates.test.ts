import { describe, it, expect } from "vitest";
import {
  contentTemplates,
  getTemplateById,
  getTemplatesByCategory,
} from "@/lib/content-templates";

describe("contentTemplates", () => {
  it("should be a non-empty array", () => {
    expect(contentTemplates).toBeInstanceOf(Array);
    expect(contentTemplates.length).toBeGreaterThan(0);
  });

  it("should contain social templates", () => {
    const socialTemplates = contentTemplates.filter(
      (t) => t.category === "social"
    );
    expect(socialTemplates.length).toBeGreaterThan(0);
  });

  it("should contain newsletter templates", () => {
    const newsletterTemplates = contentTemplates.filter(
      (t) => t.category === "newsletter"
    );
    expect(newsletterTemplates.length).toBeGreaterThan(0);
  });

  it("should have unique IDs across all templates", () => {
    const ids = contentTemplates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should have required fields on every template", () => {
    for (const template of contentTemplates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(["social", "newsletter"]).toContain(template.category);
      expect(template.icon).toBeTruthy();
    }
  });

  it("should have socialPreset on social templates", () => {
    const socialTemplates = contentTemplates.filter(
      (t) => t.category === "social"
    );
    for (const template of socialTemplates) {
      expect(template.socialPreset).toBeDefined();
      expect(template.socialPreset!.platform).toBeTruthy();
      expect(template.socialPreset!.postType).toBeTruthy();
      expect(template.socialPreset!.tone).toBeTruthy();
      expect(template.socialPreset!.context).toBeTruthy();
      expect(typeof template.socialPreset!.includeEmoji).toBe("boolean");
      expect(typeof template.socialPreset!.includeHashtags).toBe("boolean");
    }
  });

  it("should have newsletterPreset on newsletter templates", () => {
    const newsletterTemplates = contentTemplates.filter(
      (t) => t.category === "newsletter"
    );
    for (const template of newsletterTemplates) {
      expect(template.newsletterPreset).toBeDefined();
      expect(template.newsletterPreset!.topic).toBeTruthy();
      expect(template.newsletterPreset!.goals).toBeTruthy();
      expect(template.newsletterPreset!.tone).toBeTruthy();
      expect(template.newsletterPreset!.length).toBeTruthy();
      expect(typeof template.newsletterPreset!.includeCallToAction).toBe(
        "boolean"
      );
    }
  });
});

describe("getTemplateById", () => {
  it("should return a template for a valid ID", () => {
    const template = getTemplateById("social-weekend-promo");
    expect(template).toBeDefined();
    expect(template!.id).toBe("social-weekend-promo");
    expect(template!.name).toBe("Promocja weekendowa");
  });

  it("should return undefined for a non-existent ID", () => {
    const template = getTemplateById("non-existent-id");
    expect(template).toBeUndefined();
  });

  it("should return undefined for an empty string", () => {
    const template = getTemplateById("");
    expect(template).toBeUndefined();
  });

  it("should find newsletter templates by ID", () => {
    const template = getTemplateById("newsletter-monthly-promo");
    expect(template).toBeDefined();
    expect(template!.category).toBe("newsletter");
  });

  it("should return the exact template object from the contentTemplates array", () => {
    const template = getTemplateById("social-weekend-promo");
    const fromArray = contentTemplates.find(
      (t) => t.id === "social-weekend-promo"
    );
    expect(template).toBe(fromArray);
  });
});

describe("getTemplatesByCategory", () => {
  it("should return only social templates for 'social' category", () => {
    const templates = getTemplatesByCategory("social");
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.category).toBe("social");
    }
  });

  it("should return only newsletter templates for 'newsletter' category", () => {
    const templates = getTemplatesByCategory("newsletter");
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.category).toBe("newsletter");
    }
  });

  it("should return all templates when combining both categories", () => {
    const social = getTemplatesByCategory("social");
    const newsletter = getTemplatesByCategory("newsletter");
    expect(social.length + newsletter.length).toBe(contentTemplates.length);
  });

  it("should return 6 social templates", () => {
    const templates = getTemplatesByCategory("social");
    expect(templates.length).toBe(6);
  });

  it("should return 6 newsletter templates", () => {
    const templates = getTemplatesByCategory("newsletter");
    expect(templates.length).toBe(6);
  });
});
