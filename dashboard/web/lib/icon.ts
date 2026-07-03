import type { ComponentType, SVGProps } from "react";

// Local, precise type for a Phosphor icon component. Used to annotate props
// (e.g. EmptyState `icon`, NavItem `icon`) since the package's own types are
// unresolvable (see types/phosphor-icons.d.ts).
export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number | string;
  weight?: IconWeight;
  color?: string;
  mirrored?: boolean;
}

export type Icon = ComponentType<IconProps>;
