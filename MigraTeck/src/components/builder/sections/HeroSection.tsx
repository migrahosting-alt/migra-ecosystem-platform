"use client";

import type { HeroProps } from "@/lib/builder/types";

export function HeroSection({ props }: { props: HeroProps }) {
  const alignment =
    props.alignment === "left" ? "text-left items-start" :
    props.alignment === "right" ? "text-right items-end" :
    "text-center items-center";

  return (
    <section
      className="relative flex min-h-[520px] items-center justify-center px-6 py-24"
      style={props.backgroundImageUrl ? {
        backgroundImage: `url(${props.backgroundImageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } : undefined}
    >
      {props.backgroundImageUrl && (
        <div className="absolute inset-0 bg-black/40" />
      )}
      <div className={`relative z-10 flex max-w-3xl flex-col gap-6 ${alignment}`}>
        <h1 className={`text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl ${props.backgroundImageUrl ? "text-white" : "text-gray-900"}`}>
          {props.headline}
        </h1>
        <p className={`text-lg sm:text-xl ${props.backgroundImageUrl ? "text-gray-200" : "text-gray-600"}`}>
          {props.subheadline}
        </p>
        <a
          href={props.ctaHref}
          className="inline-flex w-fit rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white shadow-lg hover:bg-blue-700 transition"
        >
          {props.ctaLabel}
        </a>
      </div>
    </section>
  );
}
