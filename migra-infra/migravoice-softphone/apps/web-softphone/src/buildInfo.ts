export const appVersion = __APP_VERSION__;
export const buildSha = __BUILD_SHA__;
export const buildTime = __BUILD_TIME__;
export const releaseLabel = buildSha === 'dev' ? appVersion : `${appVersion}+${buildSha}`;

export const formattedBuildTime = new Date(buildTime).toLocaleString('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  hour12: false,
}) + ' UTC';