import { useEffect, useRef, useState } from "react";
import { browsePath, navigate, type Route } from "../lib/router";
import { Icon } from "./icons";

/**
 * The in-page search field (home top, search screen). Typing navigates to
 * the search screen live, so results appear under the field as you type.
 * The first keystroke pushes a history entry, the rest replace it, so Back
 * returns to where the search started, not through every letter.
 *
 * `autoFocus` only takes focus when nothing else has it: the sidebar field
 * keeps focus when it was the one that opened the screen.
 */
export const SearchBox = ({
  route,
  className = "",
  placeholder = "Teams, leagues, sports",
  autoFocus = false,
}: {
  route: Route;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) => {
  const query = route.kind === "search" ? route.query : "";
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(route.kind === "search" ? route.query : "");
  }, [route]);

  useEffect(() => {
    if (!autoFocus) return;
    const active = document.activeElement;
    if (active === null || active === document.body) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onChange = (next: string) => {
    setValue(next);
    navigate(browsePath({ kind: "search", query: next }), { replace: route.kind === "search", keepScroll: true });
  };

  /** Away from the search screen, touching the field opens it. */
  const open = () => {
    if (route.kind !== "search") navigate(browsePath({ kind: "search", query: value }));
  };

  return (
    <label className={`search-field ${className}`.trim()} onClick={open}>
      <Icon name="search" size={18} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label="Search matches and leagues"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onFocus={open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
            inputRef.current?.blur();
          }
        }}
      />
      {value ? (
        <button className="search-field-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name="clear" size={16} />
        </button>
      ) : null}
    </label>
  );
};
