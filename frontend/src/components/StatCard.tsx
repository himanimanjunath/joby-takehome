import type { ReactNode } from "react";

export const StatCard = ({
  label,
  singleValue,
  tooltip,
}: {
  label: string;
  singleValue: ReactNode;
  tooltip?: string;
}) => (
  <div className="stat-card" data-tooltip={tooltip}>
    <span className="stat-label">{label}</span>
    <strong className="stat-value">{singleValue}</strong>
  </div>
);
