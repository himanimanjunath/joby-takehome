import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../apiClient";

export type PartSearchResult = {
  identity: string;
  valid_from: string | null;
  valid_to: string | null;
};

export const usePartSearch = (
  q: string,
  checkTime?: string | null,
  limit = 20,
) => {
  return useQuery({
    queryKey: ["parts", "search", q, checkTime, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PartSearchResult[]>("/parts/search", {
        params: {
          q,
          ...(checkTime ? { check_time: checkTime } : {}),
          limit,
        },
      });
      return data;
    },
    enabled: q.trim().length >= 2,
  });
};
