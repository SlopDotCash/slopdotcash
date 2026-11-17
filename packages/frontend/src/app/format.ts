// spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"

const utcMinute = new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "2-digit", hour12: false, minute: "2-digit", month: "short", timeZone: "UTC", year: "numeric" });

export function formatDateTime(value: string): string {
  return `${utcMinute.format(new Date(value))} UTC`;
}
