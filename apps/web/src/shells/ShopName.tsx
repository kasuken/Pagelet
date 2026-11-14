import { SHOP_FALLBACK_NAME, useShop } from '../lib/shop';

/** The shop's name from /api/shop; reserves its space while loading so the header does not shift. */
export function ShopName() {
  const state = useShop();
  if (state.status === 'loading') {
    return (
      <span className="shop-name shop-name--loading">
        <span className="visually-hidden">{SHOP_FALLBACK_NAME}</span>
      </span>
    );
  }
  return <span className="shop-name">{state.shop?.shopName?.trim() || SHOP_FALLBACK_NAME}</span>;
}
