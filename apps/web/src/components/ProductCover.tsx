import type { PublicProduct } from '../lib/types';

export function lessonCount(product: PublicProduct): number {
  return product.sections.reduce((sum, section) => sum + section.lessons.length, 0);
}

export function productKindLabel(product: PublicProduct): string {
  if (product.productType === 'download') return 'Download';
  const count = lessonCount(product);
  return count > 0 ? `Course, ${count} ${count === 1 ? 'lesson' : 'lessons'}` : 'Course';
}

/**
 * The book-cover system: a tinted cover with a spine, the product type and its title.
 * Decorative (aria-hidden) because the same title is always given as text next to it.
 */
export function ProductCover({ product, size = 'card' }: { product: PublicProduct; size?: 'feature' | 'card' | 'detail' }) {
  return (
    <span className={`cover cover--${product.productType} cover--${size}`} aria-hidden="true">
      <span className="cover__kind">{product.productType === 'course' ? 'Course' : 'Download'}</span>
      <span className="cover__title">{product.title}</span>
      <span className="cover__mark">
        <span />
        <span />
      </span>
    </span>
  );
}
