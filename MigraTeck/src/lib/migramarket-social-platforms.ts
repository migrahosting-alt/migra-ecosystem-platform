export type SocialPlatformDefinition = {
  key: string;
  label: string;
  defaultPublishMode: "api" | "assisted";
  defaultAccessModel: "oauth" | "profile_access" | "shared_credentials";
  apiSupported: boolean;
  primaryFormats: string[];
  setupChecklist: string[];
  brandRule: string;
};

export const socialPlatformDefinitions: SocialPlatformDefinition[] = [
  {
    key: "instagram",
    label: "Instagram",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["reel", "post", "carousel", "story"],
    setupChecklist: ["Business or creator profile", "Meta app access", "Publishing scopes", "Media-ready asset URLs"],
    brandRule: "Use Powered by MigraTeck on end cards or captions.",
  },
  {
    key: "facebook",
    label: "Facebook",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["reel", "post", "video"],
    setupChecklist: ["Page admin access", "Meta app access", "Publishing scopes", "Review publish permissions"],
    brandRule: "Use Powered by MigraTeck on end cards or captions.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["post", "carousel", "video"],
    setupChecklist: ["Organization page admin", "LinkedIn app access", "Post scopes", "Approved publishing copy"],
    brandRule: "Use Powered by MigraTeck in copy or end card.",
  },
  {
    key: "tiktok",
    label: "TikTok",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["reel", "short"],
    setupChecklist: ["Business account", "TikTok app approval", "Posting scopes", "No in-video watermark branding"],
    brandRule: "Keep branding in caption/profile, not as an in-video watermark.",
  },
  {
    key: "youtube",
    label: "YouTube",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["short", "video"],
    setupChecklist: ["Channel owner access", "YouTube API project", "Upload scopes", "Thumbnail and description ready"],
    brandRule: "Use Powered by MigraTeck in description or end card.",
  },
  {
    key: "x",
    label: "X",
    defaultPublishMode: "api",
    defaultAccessModel: "oauth",
    apiSupported: true,
    primaryFormats: ["post", "video"],
    setupChecklist: ["App keys", "Media upload access", "Posting scope", "Caption and CTA ready"],
    brandRule: "Use Powered by MigraTeck in the post copy where it fits naturally.",
  },
  {
    key: "pinterest",
    label: "Pinterest",
    defaultPublishMode: "assisted",
    defaultAccessModel: "oauth",
    apiSupported: false,
    primaryFormats: ["post", "video_pin"],
    setupChecklist: ["Business account", "Board strategy", "Pin destination URLs", "Image/video-safe dimensions"],
    brandRule: "Use Powered by MigraTeck in pin copy or destination.",
  },
  {
    key: "google_business",
    label: "Google Business",
    defaultPublishMode: "assisted",
    defaultAccessModel: "oauth",
    apiSupported: false,
    primaryFormats: ["post", "offer"],
    setupChecklist: ["Business Profile owner access", "Google Business profile selected", "Offer copy reviewed", "Destination link ready"],
    brandRule: "Use Powered by MigraTeck in offer copy or linked destination.",
  },
];

export function getSocialPlatformDefinition(platform: string): SocialPlatformDefinition | null {
  return socialPlatformDefinitions.find((item) => item.key === platform.trim().toLowerCase()) || null;
}
