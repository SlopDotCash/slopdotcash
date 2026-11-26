function push(value: number): string {
  const digits = value.toString(16);
  const even = digits.length % 2 === 0 ? digits : `0${digits}`;
  return `${(0x5f + even.length / 2).toString(16)}${even}`;
}

export function words(count: number): string {
  const loads = Array.from({ length: count }, (_, index) => `600435${index === 0 ? "" : `${push(index)}01`}54${push(index * 32)}52`).join("");
  return `${loads}${push(count * 32)}${push(0)}f3`;
}
