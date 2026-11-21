import { useId, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes } from "react";
import { isUsdc } from "./money";

export type Tone = "neutral" | "auto" | "gate" | "danger" | "info" | "liquid" | "invested";

export function Button({
  variant = "primary",
  loading,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...p}
      className="bz-btn"
      data-v={variant}
      disabled={p.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? "Working…" : children}
    </button>
  );
}

export const Badge = ({
  tone = "neutral",
  hollow,
  children,
}: {
  tone?: Tone;
  hollow?: boolean;
  children: ReactNode;
}) => (
  <span className="bz-badge" data-t={tone} data-hollow={hollow || undefined}>
    {children}
  </span>
);

export const Panel = ({
  title,
  actions,
  action,
  tone,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  children: ReactNode;
}) => (
  <section className="bz-panel">
    {(title || actions) && (
  <section className="bz-panel" data-tone={tone}>
    {(title || actions || action) && (
      <header>
        <h3>{title}</h3>
        {actions}
        {actions ?? action}
      </header>
    )}
    <div className="bz-body">{children}</div>
  </section>
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const d = error || hint ? `${id}-d` : undefined;
  return (
    <div className="bz-field">
      <label htmlFor={id}>{label}</label>
      {children(id, d)}
      {error ? (
        <span id={d} className="bz-err" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={d} className="bz-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={`bz-input ${p.className || ""}`} />
);

/** Amount entry that refuses anything the ledger would round. Emits a string, never a number. */
export function UsdcInput({
  id,
  value,
  onChange,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (v: string, valid: boolean) => void;
  onChange: (v: string, valid?: boolean) => void;
  describedBy?: string;
}) {
  const bad = value !== "" && !isUsdc(value);
  return (
    <div className="bz-usdc">
      <span>USDC</span>
      <input
        id={id}
        className="bz-input"
        inputMode="decimal"
        value={value}
        aria-invalid={bad}
        aria-describedby={describedBy}
        placeholder="0.000000"
        onChange={e => {
          const v = e.target.value.trim();
          onChange(v, isUsdc(v));
        }}
      />
    </div>
  );
}

export function Select<T extends string>({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      id={id}
      className="bz-input"
      value={value}
      onChange={e => onChange(e.target.value as T)}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="bz-switch">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bz-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 10,
                fontSize: "0.75rem",
                background: t.id === value ? "var(--ink)" : "var(--sunken)",
                color: t.id === value ? "var(--paper)" : "var(--ink-2)",
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export interface Column<R> {
  key: string;
  header: string;
  align?: "r";
  render: (row: R) => ReactNode;
}

export function DataTable<R>({
  columns,
  rows,
  rowKey,
  keyExtractor,
  empty,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey?: (r: R) => string;
  keyExtractor?: (r: R) => string;
  empty?: ReactNode;
}) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  const getKey = (r: R, i: number) =>
    typeof rowKey === "function"
      ? rowKey(r)
      : typeof keyExtractor === "function"
      ? keyExtractor(r)
      : (r as any)?.id ||
        (r as any)?.keyId ||
        (r as any)?.vendorId ||
        (r as any)?.userId ||
        (r as any)?.provider ||
        (r as any)?.accountId ||
        (r as any)?.liabilityId ||
        String(i);

  return (
    <div className="bz-tablewrap">
      <table className="bz-table">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={c.align}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={getKey(r, idx)}>
              {columns.map(c => (
                <td key={c.key} className={c.align}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Banner = ({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) => (
  <div className="bz-banner" data-t={tone} role={tone === "danger" ? "alert" : "status"}>
    <div style={{ width: "100%" }}>
      {title && <strong style={{ display: "block", marginBottom: children ? 4 : 0 }}>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  </div>
);

export const EmptyState = ({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <div className="bz-empty">
    <strong>{title}</strong>
    {children}
    {action && <div style={{ marginTop: 12 }}>{action}</div>}
  </div>
);

export const Skeleton = ({
  w = "100%",
  h = 16,
}: {
  w?: number | string;
  h?: number;
}) => <div className="bz-skel" style={{ width: w, height: h }} aria-hidden />;

export const Meter = ({
  value,
  tone,
}: {
  value: number;
  tone?: "gate" | "danger";
}) => {
  const safeVal = Number.isFinite(value) ? value : 0;
  return (
    <div
      className="bz-meter"
      data-t={tone}
      role="meter"
      aria-valuenow={Math.round(safeVal)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: `${Math.max(0, Math.min(100, safeVal))}%` }} />
    </div>
  );
};

/** Addresses, hashes and keys are never silently truncated: short form for scanning, full value on copy and hover. */
export function CopyChip({
  value,
  text,
  label,
}: {
  value?: string;
  text?: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const safeVal = value || "";
  const safeVal = value || text || "";
  const short = safeVal.length > 20 ? `${safeVal.slice(0, 8)}…${safeVal.slice(-6)}` : safeVal;
  return (
    <span className="bz-chip" title={safeVal}>
      <span className="bz-hash">{short || "—"}</span>
      {safeVal && (
        <button
          type="button"
          aria-label={`Copy ${label ?? "value"}`}
          onClick={async () => {
            await navigator.clipboard?.writeText(safeVal);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      )}
    </span>
  );
}
