import { tool } from "@langchain/core/tools";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { z } from "zod";

// Curated knowledge base
const ASTROLOGY_NOTES: string[] = [
    "A natal Moon in Taurus indicates a deep need for emotional and financial stability. The Moon is exalted in Taurus, granting it exceptional strength: these individuals find comfort in the tangible world — in good food, beautiful surroundings, and the slow, rhythmic pulse of nature. They are steadfast in their affections, often forming bonds that endure for decades, though their legendary stubbornness can make releasing outworn relationships feel like pulling roots from stone.",

    "When Saturn transits Pisces, it demands that boundaries be drawn in the spiritual realm. What was once boundless — dreams, compassion, mystical surrender — must now be structured and made responsible. Artists face the discipline of craft; healers are asked to define the limits of their giving; seekers must distinguish genuine revelation from escapism. Saturn's gift here is the capacity to materialise the invisible, to give form to the formless, provided one is willing to endure the necessary contraction.",

    "Venus conjunct the Ascendant in the natal chart bestows a natural grace and magnetic social warmth. The native radiates beauty both in physical appearance and in manner, drawing others effortlessly into their orbit. Ruled by the desire to harmonise, they are skilled diplomats and peacemakers, though they may suppress their own needs to preserve the harmony of a room. In love, they seek an equal — an aesthetic, refined partner who appreciates beauty as much as they do.",

    "Mars in Scorpio in the natal chart channels desire through the archetype of the alchemist: nothing is taken at face value, every surface is probed for hidden truth. The will is iron-clad and regenerative; setbacks that would break others become the very fuel for transformation. Sexually, emotionally, and professionally, these individuals pursue intensity over comfort. The shadow temptation is the manipulation of others' vulnerabilities, a misuse of their extraordinary perceptive power.",

    "A Jupiter–Neptune conjunction in the natal chart opens a portal between the material world and the realm of infinite possibility. Optimism borders on boundlessness; the native is drawn to spirituality, art, philanthropy, and any pursuit that transcends mundane reality. When well-aspected, this placement can indicate genuine mystical gifts and humanitarian vision. When afflicted or naively expressed, it can manifest as grand illusions, financial idealism, or susceptibility to deceptive belief systems.",

    "The Sun in the 12th house places the core identity behind a veil. These individuals often feel invisible to the world, even when they achieve remarkable things, for their true solar radiance operates in private, through solitary work, contemplative retreat, or service rendered without recognition. The 12th is the house of dissolution and transcendence; the native's life purpose is frequently entwined with releasing ego-attachments and serving something larger than personal glory.",

    "Pluto transiting the 7th house fundamentally remakes the landscape of partnership. Long-standing relationships are pressure-tested: those built on authentic mutual respect survive and deepen, while those rooted in fear, dependency, or power imbalance are systematically dismantled. New partnerships formed under this transit carry fated quality — intense, transformative, and rarely ordinary. The ultimate lesson is the surrender of control in relationship, learning that true intimacy requires the courage to be seen, fully, without armour.",
];

interface EmbeddedDoc {
    text: string;
    vector: number[];
}

/** Cosine similarity via dot product (Gemini embeddings are unit-normalised). */
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

// Singleton – embeddings are computed once at first call, then cached.
let _docs: EmbeddedDoc[] | null = null;
let _embeddings: GoogleGenerativeAIEmbeddings | null = null;

async function getVectorStore(): Promise<{
    docs: EmbeddedDoc[];
    embeddings: GoogleGenerativeAIEmbeddings;
}> {
    if (_docs && _embeddings) {
        return { docs: _docs, embeddings: _embeddings };
    }

    _embeddings = new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-2",
    });

    // Embed all notes once; result is cached for the lifetime of the process.
    const vectors = await _embeddings.embedDocuments(ASTROLOGY_NOTES);
    _docs = ASTROLOGY_NOTES.map((text, i) => ({ text, vector: vectors[i] }));

    return { docs: _docs, embeddings: _embeddings };
}

/** Return the top-k notes most similar to the query string. */
async function similaritySearch(query: string, k: number): Promise<string[]> {
    const { docs, embeddings } = await getVectorStore();

    const queryVector = await embeddings.embedQuery(query);

    return docs
        .map((doc) => ({ text: doc.text, score: cosineSimilarity(queryVector, doc.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((d) => d.text);
}

// Tool definition
export const knowledge_lookup = tool(
    async ({ query }): Promise<string> => {
        try {
            const results = await similaritySearch(query, 2);

            if (results.length === 0) {
                return "No relevant entries found in the knowledge base. Please rely on your internal astrological knowledge.";
            }

            return results.join("\n\n");
        } catch (error) {
            // Graceful degradation — tell the LLM to fall back to its own knowledge.
            const message =
                error instanceof Error ? error.message : "Unknown error occurred";
            console.error("[knowledge_lookup] Vector store error:", message);
            return (
                "The astrological knowledge base is temporarily unavailable " +
                `(reason: ${message}). ` +
                "Please rely on your internal knowledge to answer the question."
            );
        }
    },
    {
        name: "knowledge_lookup",
        description:
            "Search a curated database of expert astrology notes. Use this tool to find grounded, traditional interpretations for specific planetary placements or transits.",
        schema: z.object({
            query: z
                .string()
                .describe(
                    'The astrological concept to look up (e.g., "Moon in Taurus meaning" or "Saturn transit Pisces").'
                ),
        }),
    }
);
