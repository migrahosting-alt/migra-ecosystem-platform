import Image from "next/image";

const FRAME_CLASS: Record<"sm" | "md", string> = {
  sm: "h-11 w-14 rounded-xl",
  md: "h-12 w-16 rounded-2xl",
};

const PADDING_CLASS: Record<"sm" | "md", string> = {
  sm: "p-2",
  md: "p-2.5",
};

export const ProductLogo = ({
  src,
  alt,
  size = "sm",
}: {
  src: string;
  alt: string;
  size?: "sm" | "md";
}) => {
  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-white/10 bg-white/[0.04] ${FRAME_CLASS[size]}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={size === "md" ? "64px" : "56px"}
        className={`object-contain ${PADDING_CLASS[size]}`}
      />
    </div>
  );
};