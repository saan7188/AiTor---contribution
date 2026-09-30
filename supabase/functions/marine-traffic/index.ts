// Marine Traffic API - Ship Tracking
// VesselFinder LiveData provides AIS positions for the provider's configured
// geographic subscription area. No synthetic vessel positions are generated.
import { guardPublic } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VesselFinderAis {
  MMSI?: number;
  TIMESTAMP?: string;
  LATITUDE?: number;
  LONGITUDE?: number;
  SPEED?: number;
  HEADING?: number;
  NAME?: string;
  TYPE?: string | number;
  DESTINATION?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const blocked = guardPublic(req, corsHeaders, 180);
  if (blocked) return blocked;

  try {
    const vesselFinderKey = Deno.env.get("VESSELFINDER_API_KEY");
    if (!vesselFinderKey) {
      return unavailable("Marine provider key not configured");
    }

    const endpoint = new URL("https://api.vesselfinder.com/livedata");
    endpoint.searchParams.set("userkey", vesselFinderKey);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("errormode", "409");
    endpoint.searchParams.set("interval", "5");

    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return unavailable(`Marine provider HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return unavailable("Marine provider returned an invalid payload");
    }

    const ships = payload
      .map((entry: { AIS?: VesselFinderAis }) => entry.AIS)
      .filter((ais): ais is VesselFinderAis => Boolean(ais))
      .map((ais) => ({
        mmsi: String(ais.MMSI ?? ""),
        name: ais.NAME || "Unknown",
        type: String(ais.TYPE ?? "Unknown"),
        latitude: Number(ais.LATITUDE),
        longitude: Number(ais.LONGITUDE),
        speed: ais.SPEED ?? 0,
        heading: ais.HEADING === 511 ? 0 : ais.HEADING ?? 0,
        destination: ais.DESTINATION || "Unknown",
        timestamp: ais.TIMESTAMP || new Date().toISOString(),
      }))
      .filter(
        (ship) =>
          ship.mmsi.length > 0 &&
          Number.isFinite(ship.latitude) &&
          Number.isFinite(ship.longitude),
      )
      .slice(0, 500);

    return new Response(
      JSON.stringify({
        count: ships.length,
        ships,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=180",
        },
      },
    );
  } catch (err) {
    console.error("Marine traffic error:", err);
    return unavailable("Marine provider unavailable");
  }
});

function unavailable(error: string) {
  return new Response(
    JSON.stringify({
      error,
      count: 0,
      ships: [],
      timestamp: new Date().toISOString(),
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
