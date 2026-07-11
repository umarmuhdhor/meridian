import { Target, ArrowsOutSimple, Hourglass, CircleNotch, CheckCircle, ShieldWarning, TrendDown } from "@phosphor-icons/react";
import { Badge } from "./ui/Badge";

// Position/agent status → semantic badge (Design §4.2). Icon + text + color (a11y).
export type PositionStatus =
  | "in_range"
  | "out_of_range"
  | "cooldown"
  | "pending"
  | "closed"
  | "blocked"
  | "low_yield";

export function StatusBadge({ status, detail }: { status: PositionStatus; detail?: string }) {
  switch (status) {
    case "in_range":
      return <Badge tone="profit"><Target size={12} weight="bold" />In range</Badge>;
    case "out_of_range":
      return (
        <Badge tone="warning">
          <ArrowsOutSimple size={12} weight="bold" />Out of range{detail ? ` · ${detail}` : ""}
        </Badge>
      );
    case "cooldown":
      return <Badge tone="neutral"><Hourglass size={12} />Cooldown{detail ? ` · ${detail}` : ""}</Badge>;
    case "pending":
      return (
        <Badge tone="accent" className="mrd-pulse">
          <CircleNotch size={12} className="mrd-spin" />Pending
        </Badge>
      );
    case "closed":
      return <Badge tone="neutral"><CheckCircle size={12} />Closed</Badge>;
    case "blocked":
      return <Badge tone="danger"><ShieldWarning size={12} weight="bold" />Blocked{detail ? ` · ${detail}` : ""}</Badge>;
    case "low_yield":
      return <Badge tone="warning"><TrendDown size={12} weight="bold" />Low yield</Badge>;
    default:
      return <Badge tone="neutral">{status}</Badge>;
  }
}
