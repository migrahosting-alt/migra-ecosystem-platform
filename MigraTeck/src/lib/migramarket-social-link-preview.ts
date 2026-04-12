const linkPreviewPreferredPlatforms = new Set(["facebook", "linkedin", "google_business", "pinterest"]);
const linkPreviewCapablePlatforms = new Set(["facebook", "linkedin", "google_business", "pinterest", "youtube"]);

export function platformSupportsLinkPreview(platform: string): boolean {
  return linkPreviewCapablePlatforms.has(platform.trim().toLowerCase());
}

export function platformPrefersLinkPreview(platform: string): boolean {
  return linkPreviewPreferredPlatforms.has(platform.trim().toLowerCase());
}
