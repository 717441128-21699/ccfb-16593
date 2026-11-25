import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  unit,
  foot,
  tone = '',
}: {
  label: string;
  value: string;
  unit?: string;
  foot?: ReactNode;
  tone?: '' | 'good' | 'warn' | 'bad' | 'teal' | 'amber';
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = '',
}: {
  children: ReactNode;
  tone?: '' | 'good' | 'warn' | 'bad';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function SectionTitle({
  title,
  note,
  right,
}: {
  title: string;
  note?: string;
  right?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {note ? <p className="panel-note">{note}</p> : null}
      </div>
      {right}
    </div>
  );
}
