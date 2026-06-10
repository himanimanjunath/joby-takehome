import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../apiClient";

export type PartDetail = {
  physicalid: string | null;
  part_number: string | null;
  part_description: string | null;
  source: string | null;
  mfgclass: string | null;
  maturity_level: string | null;
  design_intent: string | null;
  per_unit_mass: number | null;
  computed_mass: number | null;
  declared_mass: number | null;
  max_depth: number | null;
};

export const usePartDetail = (
  partNumber?: string | null,
  checkTime?: string | null,
) => {
  return useQuery({
    queryKey: ["parts", "detail", partNumber, checkTime],
    queryFn: async () => {
      const { data } = await apiClient.get<PartDetail>(
        `/parts/${encodeURIComponent(partNumber!)}`,
        {
          params: checkTime ? { check_time: checkTime } : {},
        },
      );
      return data;
    },
    enabled: Boolean(partNumber),
  });
};
