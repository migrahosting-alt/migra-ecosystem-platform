import { getRequestConfig } from "next-intl/server";
import { defaultLocale, locales } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = locales.includes(requested as AppLocale)
    ? (requested as AppLocale)
    : defaultLocale;
  return {
    locale,
    messages: (await import(`./${locale}.json`)).default,
  };
});

type AppLocale = (typeof locales)[number];
