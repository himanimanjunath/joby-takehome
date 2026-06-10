import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  apiClient,
  dimensionFiltersToParams,
  repeatParamsSerializer,
  type DimensionFilters,
} from "../apiClient";

export type BomTreeRow = {
  intend: string | null;
  bom_level: number;
  title: string | null;
  revision: string | null;
  part_number: string | null;
  part_description: string | null;
  parent_part_number: string | null;
  maturity_level: string | null;
  design_intent: string | null;
  source: string | null;
  mfgclass: string | null;
  product_type: string | null;
  child_quantity: number | null;
  per_unit_mass: number | null;
  total_mass: number | null;
  modified_timestamp: string | null;
};

export const useBomTree = (
  partNumber?: string | null,
  checkTime?: string | null,
  bomLevel?: number | null,
  filters?: DimensionFilters | null,
) => {
  const filterParams = dimensionFiltersToParams(filters);
  return useQuery({
    queryKey: ["bom", "tree", partNumber, checkTime, bomLevel, filterParams],
    queryFn: async () => {
      const { data } = await apiClient.get<BomTreeRow[]>("/bom/tree", {
        params: {
          part_number: partNumber,
          ...(checkTime ? { check_time: checkTime } : {}),
          ...(bomLevel != null ? { bom_level: bomLevel } : {}),
          ...filterParams,
        },
        paramsSerializer: repeatParamsSerializer,
      });
      return data;
    },
    enabled: Boolean(partNumber),
    placeholderData: keepPreviousData,
  });
};
