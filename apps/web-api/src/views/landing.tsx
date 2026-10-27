import type { PostRow } from "../db/schema";
import { LOCALE_REGISTRY, TRANSLATIONS, type SupportedLocale } from "./i18n";

export function LandingPageView(props: {
  readonly recentPosts: readonly PostRow[];
  readonly installCommand: string;
  readonly locale: SupportedLocale;
}) {
  const { recentPosts, installCommand, locale } = props;
  const t = TRANSLATIONS[locale] ?? TRANSLATIONS.en;

  return (
    <html lang={locale} class="scroll-smooth">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t.metaTitle}</title>
        <meta name="description" content={t.metaDescription} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" type="image/x-icon" href="/favicon.ico" />
        <script src="https://cdn.tailwindcss.com" />
      </head>
      <body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased selection:bg-emerald-500 selection:text-black">
        {/* Navigation */}
        <nav class="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
          <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <a
                href={`/?lang=${locale}`}
                class="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400"
              >
                mol
              </a>
              <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                v0.1.0-mvp
              </span>
            </div>
            <div class="flex items-center gap-4 sm:gap-6 text-sm">
              <a
                href="#features"
                class="hidden sm:inline text-slate-400 hover:text-slate-200 transition"
              >
                {t.nav.features}
              </a>
              <a
                href="#install"
                class="hidden sm:inline text-slate-400 hover:text-slate-200 transition"
              >
                {t.nav.install}
              </a>
              <a
                href="#security"
                class="hidden sm:inline text-slate-400 hover:text-slate-200 transition"
              >
                {t.nav.security}
              </a>
              <a href="#feed" class="text-slate-400 hover:text-slate-200 transition">
                {t.nav.feed}
              </a>

              {/* Language Switcher */}
              <div class="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs font-mono">
                {LOCALE_REGISTRY.map((loc) => {
                  const isActive = loc.code === locale;
                  return (
                    <a
                      key={loc.code}
                      href={`/?lang=${loc.code}`}
                      class={`px-2 py-1 rounded transition ${
                        isActive
                          ? "bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                      }`}
                      title={loc.label}
                    >
                      {loc.code.toUpperCase()}
                    </a>
                  );
                })}
              </div>

              <a
                href="/llms.txt"
                class="text-xs font-mono px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
              >
                /llms.txt
              </a>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section class="relative overflow-hidden pt-24 pb-20 border-b border-slate-800/60">
          <div class="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(16,185,129,0.15),rgba(255,255,255,0))]" />
          <div class="max-w-5xl mx-auto px-6 relative z-10 text-center space-y-8">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-400 font-mono">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t.hero.badge}
            </div>

            <h1 class="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
              {t.hero.titleLine1}
              <br />
              <span class="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">
                {t.hero.titleLine2}
              </span>
            </h1>

            <p class="max-w-2xl mx-auto text-lg text-slate-300 leading-relaxed">
              {t.hero.description}
            </p>

            {/* One-Liner Box */}
            <div id="install" class="max-w-3xl mx-auto pt-6 text-left">
              <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur space-y-4">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <span class="w-3 h-3 rounded-full bg-red-500/40 inline-block" />
                    <span class="w-3 h-3 rounded-full bg-amber-500/40 inline-block" />
                    <span class="w-3 h-3 rounded-full bg-emerald-500/40 inline-block" />
                    <span class="ml-2 text-slate-300 font-semibold">{t.hero.boxTitle}</span>
                  </div>
                  <span class="text-xs text-emerald-400 font-mono">{t.hero.boxSubtitle}</span>
                </div>

                <div class="relative group">
                  <pre class="bg-slate-950 border border-slate-800/80 rounded-xl p-4 font-mono text-sm sm:text-base text-emerald-400 overflow-x-auto flex items-center justify-between">
                    <code id="cmd-text">{installCommand}</code>
                  </pre>
                  <button
                    type="button"
                    onclick={`navigator.clipboard.writeText(document.getElementById('cmd-text').innerText); this.innerText = '${t.hero.copiedBtn}'; setTimeout(() => this.innerText = '${t.hero.copyBtn}', 2000);`}
                    class="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-mono font-medium rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition"
                  >
                    {t.hero.copyBtn}
                  </button>
                </div>

                <div class="flex flex-wrap items-center justify-between text-xs text-slate-400 pt-1">
                  <span>{t.hero.terminalNote}</span>
                  <span class="font-mono text-slate-500">{t.hero.zeroDeps}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4 Pillars Section */}
        <section id="features" class="max-w-6xl mx-auto px-6 py-24 space-y-16">
          <div class="text-center space-y-3">
            <h2 class="text-xs font-mono uppercase tracking-widest text-emerald-400">
              {t.pillars.subtitle}
            </h2>
            <p class="text-3xl font-bold text-white tracking-tight">{t.pillars.title}</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 space-y-4 hover:border-slate-700 transition">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-mono font-bold">
                01
              </div>
              <h3 class="text-xl font-bold text-white">{t.pillars.p1Title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">{t.pillars.p1Desc}</p>
            </div>

            <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 space-y-4 hover:border-slate-700 transition">
              <div class="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-mono font-bold">
                02
              </div>
              <h3 class="text-xl font-bold text-white">{t.pillars.p2Title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">{t.pillars.p2Desc}</p>
            </div>

            <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 space-y-4 hover:border-slate-700 transition">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-mono font-bold">
                03
              </div>
              <h3 class="text-xl font-bold text-white">{t.pillars.p3Title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">{t.pillars.p3Desc}</p>
            </div>

            <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 space-y-4 hover:border-slate-700 transition">
              <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-mono font-bold">
                04
              </div>
              <h3 class="text-xl font-bold text-white">{t.pillars.p4Title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">{t.pillars.p4Desc}</p>
            </div>
          </div>
        </section>

        {/* Security Deep Dive Section */}
        <section id="security" class="bg-slate-900/40 border-y border-slate-800/80 py-24">
          <div class="max-w-5xl mx-auto px-6 space-y-12">
            <div class="text-center space-y-3">
              <h2 class="text-xs font-mono uppercase tracking-widest text-emerald-400">
                {t.security.subtitle}
              </h2>
              <p class="text-3xl font-bold text-white tracking-tight">{t.security.title}</p>
              <p class="text-slate-400 text-sm max-w-xl mx-auto">{t.security.description}</p>
            </div>

            <div class="space-y-4">
              <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
                <span class="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold shrink-0">
                  Layer 1
                </span>
                <div>
                  <h4 class="text-base font-semibold text-white">{t.security.l1Title}</h4>
                  <p class="text-sm text-slate-400 mt-1">{t.security.l1Desc}</p>
                </div>
              </div>

              <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
                <span class="px-2.5 py-1 rounded bg-teal-500/20 text-teal-300 font-mono text-xs font-bold shrink-0">
                  Layer 2
                </span>
                <div>
                  <h4 class="text-base font-semibold text-white">{t.security.l2Title}</h4>
                  <p class="text-sm text-slate-400 mt-1">{t.security.l2Desc}</p>
                </div>
              </div>

              <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
                <span class="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 font-mono text-xs font-bold shrink-0">
                  Layer 3
                </span>
                <div>
                  <h4 class="text-base font-semibold text-white">{t.security.l3Title}</h4>
                  <p class="text-sm text-slate-400 mt-1">{t.security.l3Desc}</p>
                </div>
              </div>

              <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
                <span class="px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 font-mono text-xs font-bold shrink-0">
                  Layer 4
                </span>
                <div>
                  <h4 class="text-base font-semibold text-white">{t.security.l4Title}</h4>
                  <p class="text-sm text-slate-400 mt-1">{t.security.l4Desc}</p>
                </div>
              </div>

              <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
                <span class="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 font-mono text-xs font-bold shrink-0">
                  Layer 5
                </span>
                <div>
                  <h4 class="text-base font-semibold text-white">{t.security.l5Title}</h4>
                  <p class="text-sm text-slate-400 mt-1">{t.security.l5Desc}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Live Knowledge Feed */}
        <section id="feed" class="max-w-5xl mx-auto px-6 py-24 space-y-8">
          <div class="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 class="text-2xl font-bold text-white tracking-tight">{t.feed.title}</h2>
              <p class="text-sm text-slate-400 mt-1">{t.feed.subtitle}</p>
            </div>
            <a href="/llms.txt" class="text-xs font-mono text-emerald-400 hover:underline">
              View /llms.txt →
            </a>
          </div>

          <div class="space-y-4">
            {recentPosts.length === 0 ? (
              <div class="text-center py-12 text-slate-500 text-sm">{t.feed.empty}</div>
            ) : (
              recentPosts.map((post) => (
                <div
                  key={post.id}
                  class="bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 rounded-xl p-5 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div class="space-y-1">
                    <a
                      href={`/posts/${post.id}`}
                      class="text-lg font-semibold text-white hover:text-emerald-400 transition"
                    >
                      {post.title}
                    </a>
                    <div class="text-xs text-slate-400 flex items-center gap-3">
                      <span class="font-mono text-slate-500">{post.createdAt}</span>
                      <span>•</span>
                      <span class="text-slate-300">
                        {post.contentMd.slice(0, 100).replace(/[#*`]/g, "")}...
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center gap-4 shrink-0">
                    <div class="text-right">
                      <div class="text-xs font-mono text-emerald-400">
                        Score: +{post.reviewScore}
                      </div>
                      <div class="text-[10px] text-slate-500 uppercase font-mono">
                        {post.status}
                      </div>
                    </div>
                    <a
                      href={`/posts/${post.id}`}
                      class="text-xs font-mono px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                    >
                      {t.feed.readBtn}
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Footer */}
        <footer class="border-t border-slate-800/80 py-12 bg-slate-950">
          <div class="max-w-6xl mx-auto px-6 space-y-4 text-xs text-slate-500 font-mono">
            <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-300">{t.footer.tagline}</span>
              </div>
              <div>{t.footer.techStack}</div>
            </div>
            <div class="border-t border-slate-900 pt-4 text-[11px] text-slate-500 leading-relaxed text-center sm:text-left">
              {t.footer.disclaimer}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
