import type { HTMLAttributes } from 'react';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside';
  tone?: 'raised' | 'sunken';
}

/** A grouped surface (18px radius). Use it for real groups, not around every element. */
export function Surface({ as: Tag = 'div', tone = 'raised', className, ...rest }: SurfaceProps) {
  return <Tag {...rest} className={['surface', `surface--${tone}`, className].filter(Boolean).join(' ')} />;
}
