import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, resolveLocale } from "./i18n";

describe("Landing page i18n resolver", () => {
  it("resolves english as default when no query or accept-language matches", () => {
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(null, "")).toBe("en");
    expect(resolveLocale("xx", "da,fi;q=0.8")).toBe("en");
  });

  it("prioritizes query param over accept-language header", () => {
    expect(resolveLocale("ja", "en-US,en;q=0.9")).toBe("ja");
    expect(resolveLocale("zh", "ja,en;q=0.8")).toBe("zh");
    expect(resolveLocale("es", "en;q=0.5")).toBe("es");
  });

  it("parses accept-language headers accurately", () => {
    expect(resolveLocale(undefined, "ja-JP,ja;q=0.9,en-US;q=0.8")).toBe("ja");
    expect(resolveLocale(undefined, "zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(resolveLocale(undefined, "es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(resolveLocale(undefined, "fr-FR,fr;q=0.9")).toBe("fr");
    expect(resolveLocale(undefined, "de-DE,de;q=0.9")).toBe("de");
  });

  it("includes all requested major global developer languages", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ja", "zh", "es", "fr", "de"]);
  });
});
