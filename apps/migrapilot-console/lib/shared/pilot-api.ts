function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function pilotApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`pilotApiUrl expected absolute path, received: ${path}`);
  }

  const base = process.env.NEXT_PUBLIC_PILOT_API_BASE_URL;
  if (!base || !base.trim()) {
    return path;
  }

  return `${trimSlash(base.trim())}${path}`;
}
