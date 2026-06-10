import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../apiClient";

export type FilterOptions = {
  bom_levels: number[];
};

export const useFilterOptions = () => {
  return useQuery({
    queryKey: ["filters", "options"],
    queryFn: async () => {
      const { data } = await apiClient.get<FilterOptions>("/filters/options");
      return data;
    },
    staleTime: Infinity,
  });
};
