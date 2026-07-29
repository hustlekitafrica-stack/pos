import { useEffect, useState } from 'react';
import { database } from '@/lib/db';

/**
 * Hook to check if the local WatermelonDB database is ready.
 */
export function useDatabase() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // WatermelonDB is ready as soon as the adapter is set up
    // In the future, run migrations here if needed
    setIsReady(true);
  }, []);

  return { database, isReady };
}
