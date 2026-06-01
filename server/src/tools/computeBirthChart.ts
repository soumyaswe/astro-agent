import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as Astronomy from "astronomy-engine";

// Zodiac helpers
const ZODIAC_SIGNS = [
    "Aries",
    "Taurus",
    "Gemini",
    "Cancer",
    "Leo",
    "Virgo",
    "Libra",
    "Scorpio",
    "Sagittarius",
    "Capricorn",
    "Aquarius",
    "Pisces",
] as const;

/**
 * Convert a 0–360° ecliptic longitude into a human-readable zodiac placement.
 * Returns e.g. "Scorpio 15°"
 */
function longitudeToZodiac(lon: number): string {
    // Normalise to [0, 360)
    const normalised = ((lon % 360) + 360) % 360;
    const signIndex = Math.floor(normalised / 30);
    const degree = Math.floor(normalised % 30);
    return `${ZODIAC_SIGNS[signIndex]} ${degree}°`;
}

// "Sun" is handled separately because astronomy-engine's EclipticLongitude
// only works for non-solar bodies; the Sun needs SunPosition().elon.
const PLANETS = [
    "Moon",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
] as const;

// Tool definition
export const compute_birth_chart = tool(
    async ({
        date,
        time,
        latitude,
        longitude,
    }): Promise<string> => {
        try {
            //Parse separate YYYY-MM-DD and HH:MM strings into a strictly UTC AstroTime
            const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
            if (!dateMatch || !timeMatch) {
                return JSON.stringify({
                    error: `Invalid format. Expected date "YYYY-MM-DD" (got "${date}") and time "HH:MM" (got "${time}").`,
                });
            }
            const [, yr, mo, dy] = dateMatch.map(Number);
            const [, hr, mn] = timeMatch.map(Number);
            const utcMs = Date.UTC(yr, mo - 1, dy, hr, mn);
            const astroDate = new Date(utcMs);
            const astroTime = Astronomy.MakeTime(astroDate);

            const _observer = new Astronomy.Observer(latitude, longitude, 0);

            //Compute Sun position
            const sunEcliptic = Astronomy.SunPosition(astroTime);
            const chart: Record<string, string> = {
                Sun: longitudeToZodiac(sunEcliptic.elon),
            };

            //Compute all other planets
            for (const planet of PLANETS) {
                const lon = Astronomy.EclipticLongitude(
                    Astronomy.Body[planet],
                    astroTime
                );
                chart[planet] = longitudeToZodiac(lon);
            }

            //Return JSON
            return JSON.stringify(chart, null, 2);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown error";
            return JSON.stringify({
                error: `Failed to compute birth chart: ${message}`,
            });
        }
    },
    {
        name: "compute_birth_chart",
        description:
            "Calculate the accurate planetary positions for a user's birth chart using real astronomical data. Require latitude and longitude. If you only have a city name, use the geocode_place tool first.",
        schema: z.object({
            date: z
                .string()
                .regex(
                    /^\d{4}-\d{2}-\d{2}$/,
                    'Must be in "YYYY-MM-DD" format, e.g. "1995-10-23"'
                )
                .describe('Birth date in "YYYY-MM-DD" format, e.g. "1995-10-23"'),
            time: z
                .string()
                .regex(
                    /^\d{2}:\d{2}$/,
                    'Must be in "HH:MM" format (UTC), e.g. "14:30"'
                )
                .describe('Birth time in UTC as "HH:MM", e.g. "14:30"'),
            latitude: z
                .number()
                .describe("Geographic latitude of the birth location (-90 to 90)"),
            longitude: z
                .number()
                .describe("Geographic longitude of the birth location (-180 to 180)"),
        }),
    }
);
