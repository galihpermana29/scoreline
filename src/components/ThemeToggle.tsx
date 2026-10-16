import { AnimatePresence, motion } from "motion/react";
import { toggleTheme, useTheme } from "../lib/theme";
import { Icon } from "./icons";

const SWAP = { type: "spring", bounce: 0.25, duration: 0.45 } as const;

/** The glyph shows the appearance you would switch to, rotating in like a dial. */
const ThemeGlyph = ({ size }: { size: number }) => {
  const theme = useTheme();
  return (
    <span className="theme-glyph" style={{ width: size, height: size }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={theme}
          className="theme-glyph-face"
          initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
          transition={SWAP}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={size} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

/**
 * Appearance switch. `row` matches the sidebar's nav rows (icon column +
 * label, so it survives the rail collapse); `pill` is the round translucent
 * button used where there is no sidebar, over the home hero on phones.
 */
export const ThemeToggle = ({ variant }: { variant: "row" | "pill" }) => {
  const theme = useTheme();
  const label = theme === "dark" ? "Light Mode" : "Dark Mode";
  const action = `Switch to ${label.toLowerCase()}`;
  if (variant === "pill") {
    return (
      <button className="theme-pill" aria-label={action} title={action} onClick={toggleTheme}>
        <ThemeGlyph size={18} />
      </button>
    );
  }
  return (
    <button className="nav-item theme-row" aria-label={action} title={action} onClick={toggleTheme}>
      <span className="nav-icon">
        <ThemeGlyph size={20} />
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
};
