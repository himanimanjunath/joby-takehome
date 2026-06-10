import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    return Promise.reject(error);
  },
);

// FastAPI expects repeated query params (?mfgclass=A&mfgclass=B), not the
// bracketed form axios produces by default (?mfgclass[]=A&mfgclass[]=B).
export const repeatParamsSerializer = (params: Record<string, unknown>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item != null) sp.append(k, String(item));
      }
    } else if (typeof v === "boolean") {
      sp.append(k, v ? "true" : "false");
    } else {
      sp.append(k, String(v));
    }
  }
  return sp.toString();
};

export type MaturityIntentPair = { maturity_level: string; design_intent: string };

export type DimensionFilters = {
  mfgclass: string[];
  source: string[];
  maturity_intent_pairs: MaturityIntentPair[];
};

export const EMPTY_DIMENSION_FILTERS: DimensionFilters = {
  mfgclass: [],
  source: [],
  maturity_intent_pairs: [],
};

export const dimensionFiltersToParams = (
  filters?: DimensionFilters | null,
): Record<string, string[]> => {
  if (!filters) return {};
  const out: Record<string, string[]> = {};
  if (filters.mfgclass.length) out.mfgclass = filters.mfgclass;
  if (filters.source.length) out.source = filters.source;
  if (filters.maturity_intent_pairs.length) {
    out.maturity_intent_pair = filters.maturity_intent_pairs.map(
      (p) => `${p.maturity_level}|${p.design_intent}`,
    );
  }
  return out;
};
