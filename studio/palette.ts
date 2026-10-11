export const CARD_COLORS: { name: string; hex: string }[] = [
  { name: "Gold", hex: "#e2c074" },
  { name: "Blue", hex: "#7ea2c4" },
  { name: "Green", hex: "#7dba8a" },
  { name: "Rose", hex: "#d48b8b" },
  { name: "Violet", hex: "#b09bc9" },
  { name: "Slate", hex: "#8e98a4" },
  { name: "Sand", hex: "#d8c4a2" },
];

export function cardHex(color: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/u.test(color)) return color;
  const wide = /^#([0-9a-fA-F]{4})([0-9a-fA-F]{4})([0-9a-fA-F]{4})$/u.exec(color);
  if (wide) return `#${wide[1]!.slice(0, 2)}${wide[2]!.slice(0, 2)}${wide[3]!.slice(0, 2)}`;
  return CARD_COLORS.find((item) => item.name.toLowerCase() === color.toLowerCase())?.hex ?? "#e2c074";
}

export function snapTo(value: number, enabled: boolean): number {
  if (!enabled) return Math.round(value);
  return Math.round(value / 8) * 8;
}
