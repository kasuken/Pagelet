import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}

export function EmptyState({ title, children, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="empty-state">
      <span className="empty-state__shelf" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <Heading className="empty-state__title">{title}</Heading>
      {children ? <div className="empty-state__body">{children}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
