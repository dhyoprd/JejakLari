import type { ReactNode } from 'react';

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function ChipGroup<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T;
  options: Array<{ id: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <div
      className="chip-grid"
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.id}
          className={`chip ${value === option.id ? 'chip-active' : ''}`}
          onClick={() => onChange(option.id)}
          title={option.hint}
        >
          <span>{option.label}</span>
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function Swatches({
  value,
  colors,
  onChange,
  label,
}: {
  value: string;
  colors: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="swatch-row">
      <span className="field-label">{label}</span>
      <div className="swatches">
        {colors.map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`${label} ${color}`}
            className={`swatch ${value.toLowerCase() === color.toLowerCase() ? 'swatch-active' : ''}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}
