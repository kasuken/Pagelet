import { Skeleton } from '../components/Skeleton';

export function RouteFallback({ label }: { label: string }) {
  return (
    <div className="wrap route-fallback">
      <Skeleton label={label} lines={4} />
    </div>
  );
}
