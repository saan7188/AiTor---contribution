import { usePolledConnector, safeFetchJson } from "@/lib/connectors";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://wkdtvrxavkhbifjtvvdw.supabase.co";

export interface Ship {
  mmsi: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  destination: string;
  timestamp: string;
}

interface MarineTrafficResponse {
  ships?: Ship[];
  error?: string;
}

/** Poll the real AIS endpoint only while the marine layer is enabled. */
export function useMarineTraffic(enabled = true, intervalMs = 180_000) {
  return usePolledConnector<Ship[]>(
    async (signal) => {
      const response = await safeFetchJson<MarineTrafficResponse>(
        `${SUPABASE_URL}/functions/v1/marine-traffic`,
        { signal, timeoutMs: 12_000 },
      );

      if (response.error) throw new Error(response.error);

      const ships = (response.ships ?? []).filter((ship) =>
        typeof ship.mmsi === "string" &&
        ship.mmsi.trim().length > 0 &&
        Number.isFinite(ship.latitude) &&
        ship.latitude >= -90 && ship.latitude <= 90 &&
        Number.isFinite(ship.longitude) &&
        ship.longitude >= -180 && ship.longitude <= 180
      );
      if (!ships.length) throw new Error("Marine provider returned no valid vessel positions");
      return ships;
    },
    [],
    intervalMs,
    enabled,
  );
}
