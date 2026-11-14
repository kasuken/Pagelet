import { useEffect } from 'react';
import { useShopName } from './shop';

export function useDocumentTitle(title: string): void {
  const shopName = useShopName();
  useEffect(() => {
    const parts = [title, shopName].filter(Boolean);
    document.title = parts.length > 0 ? parts.join(' | ') : 'Shop';
  }, [title, shopName]);
}
