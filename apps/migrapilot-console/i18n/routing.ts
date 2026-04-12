export const locales = ["en"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";
