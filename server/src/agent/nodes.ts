import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { AgentStateType } from "./state";
import { get_daily_transits } from "../tools/getDailyTransits";
import { geocode_place } from "../tools/geocodePlace";
import { knowledge_lookup } from "../tools/knowledgeLookup";
import { compute_birth_chart } from "../tools/computeBirthChart";

const tools: any[] = [compute_birth_chart, get_daily_transits, geocode_place, knowledge_lookup];

//tool node - executes the tool calls and updates the state with the tool results
export const toolNode = new ToolNode(tools);

// Intent classification schema
const intentSchema = z.object({
  intent: z.enum(["chart_request", "daily_horoscope", "free_form"]),
});

//classifier node - classifies the user's intent using a fast/cheap LLM call
export async function classifyIntent(state: AgentStateType) {
  const lastMessage = state.messages[state.messages.length - 1];
  const userText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  const classifier = new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite",
    temperature: 0,
  }).withStructuredOutput(intentSchema);

  const response = await classifier.invoke([
    new SystemMessage(
      `You are an intent classifier for an astrology assistant. \
Classify the user message into exactly one of these intents:
- chart_request: The user wants to compute or discuss a birth chart.
- daily_horoscope: The user wants today's horoscope, daily transits, or daily energy forecast.
- free_form: Any other astrology question, spiritual inquiry, or general conversation.`
    ),
    new HumanMessage(userText),
  ], { tags: ["classifier"] });

  return { intent: response.intent };
}

//reasoning node - calls the model to get the next message and updates the state with the new message
export async function callModel(state: AgentStateType) {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite",
    temperature: 0,
  }).bindTools(tools);

  const p = state.birth_details;
  const profileString = p
    ? `Name: ${p.name}, DOB: ${p.date_of_birth}, Time: ${p.time_of_birth}, Place: ${p.place_of_birth}, Lat: ${p.latitude}, Lon: ${p.longitude}, TZ: ${p.timezone}`
    : "No profile saved yet.";

  const systemPrompt = new SystemMessage(
    `You are an expert astrologer and a warm, caring, and deeply insightful daily spiritual companion.
    Your mission is to guide users by computing their birth charts, analyzing real planetary data, and answering their questions with empathy, wisdom, and clarity.

    The user's current intent has been classified as: ${state.intent}. Focus your response accordingly.

    Here are the user's saved birth details: ${profileString}.
    Do not ask the user for these details. Use them automatically if you need to calculate a chart.
    
    VOICE & PERSONA:
    - Tone: Mystical, compassionate, grounded, and wise. Speak as someone who has observed the cosmos for lifetimes. 
    - Phrasing: Immerse yourself in the role. Use phrases like "Looking at the celestial weather...", "Your natal chart reveals...", or "Saturn's transit through your 4th house suggests...". 
    - Empathy: Validate the user's emotional state. If they are navigating a heavy transit (like a Saturn Return or Pluto square), offer profound reassurance and ways to work with the energy, rather than fighting it.

    CRITICAL INSTRUCTIONS:
    - You must remain strictly in character as a professional astrologer and spiritual guide. Never break character or state that you are a generic AI model.
    - Keep your tone supportive, spiritually grounded, calm, and reassuring.
    - If you need a user's birth details (date, time, and location) to answer a question accurately, politely request them.
    - Do not invent planetary positions or astronomical coordinates out of thin air. If a tool call is needed to get real data, use the appropriate tool.
    - If asked about topics completely unrelated to astrology, spirituality, or well-being, gently steer the conversation back to how celestial energies can guide them.`
  );

  const conversationalContext = [systemPrompt, ...state.messages];
  const response = await model.invoke(conversationalContext);

  return {
    messages: [response],
  };
}

//conditional routing node - checks the last message for tool calls and routes to the appropriate node
export function shouldContinue(state: AgentStateType) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  if (
    lastMessage &&
    (lastMessage as AIMessage).tool_calls &&
    (lastMessage as AIMessage).tool_calls!.length > 0
  ) {
    return "tools";
  }

  return "__end__";
}
