/* ──────────────────────────────────────────────────────────────
   MigraHosting public-site token map
   ────────────────────────────────────────────────────────────── */

export const maxW = "mx-auto max-w-7xl px-5 sm:px-6 lg:px-8";
export const maxWNarrow = "mx-auto max-w-5xl px-5 sm:px-6 lg:px-8";

export const sectionPy = "py-20 sm:py-24";
export const sectionPySmall = "py-14 sm:py-18";

export const card =
  "surface-card rounded-[28px]";

export const cardHover =
  "transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_56px_rgba(109,40,217,0.12)]";

export const cardMuted =
  "rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.78)]";

export const cardStrong =
  "surface-card-solid rounded-[30px]";

export const cardDark = cardStrong;

export const cardDarkHover = cardHover;

export const eyebrow =
  "text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-soft)]";

export const eyebrowBrand =
  "text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand-violet)]";

export const h1 =
  "font-[var(--font-display)] text-5xl font-semibold tracking-[-0.05em] text-[var(--brand-ink)] sm:text-6xl lg:text-7xl";

export const h2 =
  "font-[var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)] sm:text-4xl lg:text-[3rem]";

export const h3 =
  "font-[var(--font-display)] text-xl font-semibold tracking-[-0.03em] text-[var(--brand-ink)] sm:text-2xl";

export const body =
  "text-base leading-7 text-[var(--brand-muted)] sm:text-lg sm:leading-8";

export const bodySmall =
  "text-sm leading-6 text-[var(--brand-muted)]";

export const eyebrowDark = eyebrowBrand;

export const eyebrowDarkMuted = eyebrow;

export const h1Dark = h1;

export const h2Dark = h2;

export const h3Dark = h3;

export const bodyDark = body;

export const bodyDarkMuted = bodySmall;

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#7c3aed,#d946ef_58%,#fb923c)] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(160,88,224,0.28)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_48px_rgba(160,88,224,0.34)]";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line-strong)] bg-white/90 px-6 py-3 text-sm font-semibold text-[var(--brand-ink)] shadow-[0_8px_24px_rgba(109,40,217,0.08)] transition duration-200 hover:-translate-y-0.5 hover:bg-white";

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-[var(--brand-muted)] transition duration-200 hover:bg-white/75 hover:text-[var(--brand-ink)]";

export const btnPrimaryLight = btnPrimary;

export const btnSecondaryDark = btnSecondary;

export const btnGhostDark = btnGhost;

export const logoBadge =
  "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/80 bg-white p-1 shadow-[0_10px_28px_rgba(109,40,217,0.12)]";

export const logoBadgeLg =
  "relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[24px] border border-white/80 bg-white p-2 shadow-[0_14px_34px_rgba(109,40,217,0.12)]";

export const logoBadgeDark = logoBadge;

export const pill =
  "inline-flex items-center rounded-full border border-[var(--line)] bg-white/82 px-3 py-1 text-xs font-medium text-[var(--brand-muted)]";

export const pillDark = pill;

export const statusBadge =
  "inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-700";

export const depthNum =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7c3aed,#fb7185)] text-xs font-bold text-white";

export const navLink =
  "rounded-full px-3 py-2 text-sm font-medium text-[var(--brand-muted)] transition duration-150 hover:bg-white/78 hover:text-[var(--brand-ink)]";

const ui = {
  maxW,
  maxWNarrow,
  sectionPy,
  sectionPySmall,
  card,
  cardHover,
  cardMuted,
  cardStrong,
  cardDark,
  cardDarkHover,
  eyebrow,
  eyebrowBrand,
  eyebrowDark,
  eyebrowDarkMuted,
  h1,
  h2,
  h3,
  h1Dark,
  h2Dark,
  h3Dark,
  body,
  bodySmall,
  bodyDark,
  bodyDarkMuted,
  btnPrimary,
  btnSecondary,
  btnGhost,
  btnPrimaryLight,
  btnSecondaryDark,
  btnGhostDark,
  logoBadge,
  logoBadgeLg,
  logoBadgeDark,
  pill,
  pillDark,
  statusBadge,
  depthNum,
  navLink,
};

export default ui;
