export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

export const formatDateTime = (dt: string | null | undefined): string => {
  if (!dt) return "";
  try {
    const d = new Date(dt.replace(" ", "T"));
    if (isNaN(d.getTime())) return dt;
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const h = d.getHours(), m = d.getMinutes();
    if (h === 0 && m === 0) return date;
    return `${date}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  } catch {
    return dt ?? "";
  }
};

export const getHeatmapKey = (mfgClass: string, maturity: string) => `${mfgClass}::${maturity}`;

export const toDatetimeLocal = (dt: string | null): string => {
  if (!dt) return "";
  return dt.replace(" ", "T").slice(0, 16);
};

export const nowPT = (): string => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = fmt.formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

export const isTimeValid = (time: string | null, validFrom: string | null, validTo: string | null): boolean => {
  if (!time || !validFrom) return true;
  const t = new Date(time), from = new Date(validFrom);
  if (isNaN(t.getTime()) || isNaN(from.getTime())) return true;
  from.setSeconds(0, 0);
  if (t < from) return false;
  if (validTo) {
    const to = new Date(validTo);
    if (!isNaN(to.getTime()) && t > to) return false;
  }
  return true;
};

export const timeRangeError = (time: string | null, validFrom: string | null, validTo: string | null): string | null => {
  if (!time || !validFrom || isTimeValid(time, validFrom, validTo)) return null;
  return `Valid time range: ${formatDateTime(validFrom)}${validTo ? ` – ${formatDateTime(validTo)}` : " or later"}`;
};

export const toLabel = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const intendAncestors = (intend: string): string[] => {
  const segs = intend.split("|");
  const result: string[] = [];
  for (let i = 1; i < segs.length; i++) result.push(segs.slice(0, i).join("|"));
  return result;
};
