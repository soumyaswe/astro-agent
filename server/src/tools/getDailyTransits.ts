import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as Astronomy from "astronomy-engine";

// Helper function to map degree (0-360) to Zodiac sign and degree
function getZodiacSign(longitude: number): { sign: string; degree: number } {
  const signs = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", 
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
  ];
  
  // Normalize longitude to 0-360 range
  const normalizedLongitude = ((longitude % 360) + 360) % 360;
  const signIndex = Math.floor(normalizedLongitude / 30);
  const degree = normalizedLongitude % 30;
  
  return {
    sign: signs[signIndex],
    degree: Number(degree.toFixed(2))
  };
}

export const get_daily_transits = tool(
  async ({ date }) => {
    try {
      // Parse the date string (YYYY-MM-DD format)
      const dateObj = new Date(date);
      
      // Validate the date
      if (isNaN(dateObj.getTime())) {
        return JSON.stringify({
          error: "Invalid date format. Please use YYYY-MM-DD (e.g., 2024-06-02)."
        });
      }

      // Define the celestial bodies we want to track
      const bodies = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

      const results: Record<string, string> = {};

      // Calculate the ecliptic longitude for each body
      for (const body of bodies) {
        try {
          // Convert equatorial coordinates (RA/Dec) to ecliptic longitude
          const vector = Astronomy.GeoVector(body as Astronomy.Body, dateObj, false);
          const ecl = Astronomy.Ecliptic(vector);
          
          const longitude = ecl.elon;
          
          // Map to zodiac sign
          const { sign, degree } = getZodiacSign(longitude);
          results[body] = `${degree}° ${sign}`;
        } catch (err) {
          results[body] = `Error calculating position: ${err instanceof Error ? err.message : "Unknown error"}`;
        }
      }

      // Return beautifully formatted JSON string
      return JSON.stringify(
        {
          date: date,
          transits: results,
          note: "These are the current planetary transits for the given date. Compare with the user's natal chart to provide astrological insights."
        },
        null,
        2
      );
    } catch (error) {
      return JSON.stringify({
        error: `Failed to calculate transits: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  },
  {
    name: "get_daily_transits",
    description: "Fetch real, mathematically accurate current planetary positions (transits) for a specific date. The LLM will use this data to relate the transits to the user's natal chart.",
    schema: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date in YYYY-MM-DD format (e.g., 2024-06-02)")
    }),
  }
);