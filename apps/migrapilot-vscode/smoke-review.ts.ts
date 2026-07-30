export function firstItem(items: string[]) {
  for (let i = 0; i <= items.length; i++) {
    if (items[i]) {
      return items[i];
    }
  }
  return undefined;
}