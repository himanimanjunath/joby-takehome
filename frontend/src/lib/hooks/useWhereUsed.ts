import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../apiClient";

export type WhereUsedRow = {
  part_number: string | null;
  part_description: string | null;
  child_quantity: number | null;
};

export const useWhereUsed = (
  partNumber?: string | null,
  checkTime?: string | null,
) => {
  return useQuery({
    queryKey: ["bom", "where-used", partNumber, checkTime],
    queryFn: async () => {
      const { data } = await apiClient.get<WhereUsedRow[]>(
        "/bom/where-used",
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