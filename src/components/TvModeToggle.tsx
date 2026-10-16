import { toggleTvMode, useTvMode } from "../lib/tvmode";
import { Icon } from "./icons";

/**
 * TV Mode switch, pinned as a sidebar row next to the theme switch. The
 * on-state stays legible from a sofa: the icon column tints, so a glance
 * at the rail answers "is this browser in TV mode?" without reading text.
 */
export const TvModeToggle = () => {
  const mode = useTvMode();
  const on = mode === "on";
  const action = on ? "Turn TV Mode off" : "Turn TV Mode on";
  return (
    <button
      className={`nav-item tv-row${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={action}
      title={on ? "TV Mode on: the mouse cursor is hidden over this app and the D-pad drives every control - arrows move focus, Enter activates" : "TV Mode: for a TV remote (TVBro etc) - hides the mouse cursor over this app and lets arrow keys drive every control"}
      onClick={toggleTvMode}
    >
      <span className="nav-icon">
        <Icon name="tv" size={20} />
      </span>
      <span className="nav-label">TV Mode</span>
    </button>
  );
};