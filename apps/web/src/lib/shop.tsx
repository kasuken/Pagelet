import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { usableAccent } from './contrast';
import type { PublicShop } from './types';

export type ShopState =
  | { status: 'loading'; shop: null }
  | { status: 'ready'; shop: PublicShop }
  | { status: 'failed'; shop: null; error: unknown };

const ShopContext = createContext<ShopState>({ status: 'loading', shop: null });

/** Neutral label used before the shop profile loads or when it cannot load. */
export const SHOP_FALLBACK_NAME = 'Shop';

export function ShopProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShopState>({ status: 'loading', shop: null });

  useEffect(() => {
    const controller = new AbortController();
    api<PublicShop>('/api/shop', { signal: controller.signal })
      .then((shop) => setState({ status: 'ready', shop }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'failed', shop: null, error });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // CSSOM writes are allowed by the CSP (style-src 'self'); inline style attributes are not.
    const accent = usableAccent(state.shop?.accentHex);
    const root = document.documentElement;
    if (accent) root.style.setProperty('--shop-accent', accent);
    else root.style.removeProperty('--shop-accent');
  }, [state.shop?.accentHex]);

  return <ShopContext value={state}>{children}</ShopContext>;
}

export function useShop(): ShopState {
  return use(ShopContext);
}

export function useShopName(): string | null {
  const { shop } = useShop();
  return shop?.shopName?.trim() || null;
}
