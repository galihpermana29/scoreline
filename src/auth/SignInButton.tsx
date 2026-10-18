import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Icon } from "../components/icons";
import { openSignIn } from "./signInUi";

/**
 * The account control. Signed out, it opens the sign-in modal and the
 * rest of the app keeps working. Signed in, the same control signs out,
 * which returns the viewer to guest mode without leaving the screen.
 * `row` matches the sidebar; `pill` is the round button used on a phone,
 * where there is no sidebar.
 */
export const SignInButton = ({ variant, className }: { variant: "row" | "pill"; className?: string }) => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  if (isLoading) return null;

  const label = isAuthenticated ? "Sign out" : "Sign in";
  const onClick = () => {
    if (isAuthenticated) void signOut();
    else openSignIn();
  };

  if (variant === "pill") {
    return (
      <button className={["theme-pill", className].filter(Boolean).join(" ")} aria-label={label} title={label} onClick={onClick}>
        <Icon name="person" size={18} />
      </button>
    );
  }
  return (
    <button className={["nav-item", className].filter(Boolean).join(" ")} aria-label={label} title={label} onClick={onClick}>
      <span className="nav-icon">
        <Icon name="person" size={20} />
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
};
