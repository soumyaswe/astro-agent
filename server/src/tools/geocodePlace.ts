import { tool } from "@langchain/core/tools";
import { z } from "zod";
// Shape of the Open-Meteo geocoding API response
interface GeocodingApiResponse {
  results?: Array<{
    latitude: number;
    longitude: number;
    timezone: string;
    [key: string]: unknown; // allow extra fields we don't use
  }>;
}

// Shape of a successful geocoding result returned to the caller
interface GeocodeResult {
  latitude: number;
  longitude: number;
  timezone: string;
}
export const geocode_place = tool(
  async ({ place_name }): Promise<string> => {
    try {
      const encodedName = encodeURIComponent(place_name.trim());
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodedName}&count=1&format=json`;
      const response = await fetch(url);
      if (!response.ok) {
        return JSON.stringify({
          error: `Geocoding API returned an error: ${response.status} ${response.statusText}`,
        });
      }
      const data = (await response.json()) as GeocodingApiResponse;
      // Validate that results are present and non-empty
      if (
        !data.results ||
        !Array.isArray(data.results) ||
        data.results.length === 0
      ) {
        return "Location not found, please try a different city.";
      }
      const first = data.results[0];
      const result: GeocodeResult = {
        latitude: first.latitude,
        longitude: first.longitude,
        timezone: first.timezone,
      };
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        error: `Failed to geocode place: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  },
  {
    name: "geocode_place",
    description:
      "Resolve a place name (city, region, or country) to its latitude, longitude, and timezone. This is required to get accurate coordinates for astrological chart math.",
    schema: z.object({
      place_name: z
        .string()
        .describe(
          'The name of the city, region, or country to geocode (e.g., "Khardaha", "London", "New York").'
        ),
    }),
  }
);
