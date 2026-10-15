import { useState } from "react";

/** Team or league crest with an initials fallback, so a missing image never leaves a hole. */
export const Crest = ({ src, name, size = 28 }: { src: string | null; name: string; size?: number }) => {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return src && !failed ? (
    <img
      className={`crest${loaded ? " is-loaded" : ""}`}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="crest crest-fallback" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
};

export const Notice = ({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) => (
  <div className="notice">
    <div className="notice-icon" aria-hidden>
      {icon}
    </div>
    <h2 className="notice-title">{title}</h2>
    {body ? <p className="notice-body">{body}</p> : null}
    {action ? (
      <button className="button-tinted" onClick={action.onClick}>
        {action.label}
      </button>
    ) : null}
  </div>
);

export const Chevron = ({ direction = "right" }: { direction?: "right" | "left" }) => (
  <svg className="chevron" width="8" height="14" viewBox="0 0 8 14" aria-hidden>
    <path
      d={direction === "right" ? "M1 1l6 6-6 6" : "M7 1L1 7l6 6"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
