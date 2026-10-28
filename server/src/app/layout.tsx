import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { getT } from "@/lib/i18n/server";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import { DISPLAY_TZ } from "@/lib/time";
import { Nav } from "@/components/nav";
import { THEME_COOKIE, parseThemePref } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "IQOS Monitor",
  description: "Device history and live statistics",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, t } = await getT();
  const store = await cookies();
  const override = store.get(LOCALE_COOKIE)?.value ?? null;
  const theme = parseThemePref(store.get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} data-theme={theme === "auto" ? undefined : theme}>
      <body className="flex min-h-full flex-col">
        <I18nProvider value={{ t, locale, tz: DISPLAY_TZ }}>
          <Nav override={override} theme={theme} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
