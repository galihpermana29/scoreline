import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Icon } from "../components/icons";
import { openAlerts } from "./alertsUi";

/**
 * Opens the alerts picker. The dot says at least one alert is on. This is
 * one of the only places that reads the account (with the gate and the
 * picker), so a session refresh re-renders just this button.
 */
export const BellButton = ({ variant }: { variant: "row" | "pill" }) => {
  const mine = useQuery(api.alerts.mine);
  const on = mine != null && mine.clubs.length + mine.sports.length > 0;
  const dot = on ? <span className="bell-dot" aria-hidden /> : null;
  const label = on ? "Match alerts (on)" : "Match alerts";

  if (variant === "pill") {
    return (
      <button className="theme-pill bell-pill" aria-label={label} title={label} onClick={openAlerts}>
        <Icon name="bell" size={18} />
        {dot}
      </button>
    );
  }
  return (
    <button className="nav-item bell-row" aria-label={label} title={label} onClick={openAlerts}>
      <span className="nav-icon bell-icon">
        <Icon name="bell" size={20} />
        {dot}
      </span>
      <span className="nav-label">Alerts</span>
    </button>
  );
};
