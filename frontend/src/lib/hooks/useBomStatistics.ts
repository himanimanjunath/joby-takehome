import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../apiClient";

export type BomStatsPart = {
  physicalid: string | null;
  title: string | null;
  revision: string | null;
  part_number: string | null;
  part_description: string | null;
  source: string | null;
  mfgclass: string | null;
  maturity_level: string | null;
  design_intent: string | null;
  product_type: string | null;
  bom_level: number | null;
  child_quantity: number | null;
  flatten_quantity: number | null;
  per_unit_mass: number | null;
  total_mass: number | null;
  modified_timestamp: string | null;
};

export type BomStatisticsResponse = {
  root_mass_g: number | null;
  parts: BomStatsPart[];
};

export const useBomStatistics = (
  partNumber?: string | null,
  checkTime?: string | null,
) => {
  return useQuery({
    queryKey: ["bom", "statistics", partNumber, checkTime],
    queryFn: async () => {
      const { data } = await apiClient.get<BomStatisticsResponse>(
        "/bom/statistics",
        {
          params: {
            part_number: partNumber,
            ...(checkTime ? { check_time: checkTime } : {}),
          },
        },
      );
      return data;
    },
    enabled: Boolean(partNumber),
  });
};
