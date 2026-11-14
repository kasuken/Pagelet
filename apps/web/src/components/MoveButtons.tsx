import { Button } from './Button';

/** Keyboard-accessible reordering: explicit Move up and Move down buttons named after the item. */
export function MoveButtons({ itemLabel, index, count, onMove, disabled }: { itemLabel: string; index: number; count: number; onMove: (from: number, to: number) => void; disabled?: boolean }) {
  return (
    <span className="move-buttons">
      <Button variant="quiet" disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}>
        Move up<span className="visually-hidden">: {itemLabel}</span>
      </Button>
      <Button variant="quiet" disabled={disabled || index === count - 1} onClick={() => onMove(index, index + 1)}>
        Move down<span className="visually-hidden">: {itemLabel}</span>
      </Button>
    </span>
  );
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined || to < 0 || to > next.length) return [...items];
  next.splice(to, 0, item);
  return next;
}
