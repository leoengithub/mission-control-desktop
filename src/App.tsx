import { useEffect, useState } from 'react';
import { getFoundationStatus } from './lib/missionControl';
import type { FoundationStatus } from './contracts';

export function App() {
  const [status, setStatus] = useState<FoundationStatus | null>(null);

  useEffect(() => {
    void getFoundationStatus().then(setStatus);
  }, []);

  // The product interface intentionally remains unshaped until PRODUCT.md,
  // DESIGN.md, references, and a confirmed design brief exist.
  return <div data-mission-control-foundation={status?.settingsSchemaVersion ?? 'loading'} />;
}
