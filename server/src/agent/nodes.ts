import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentStateType } from "./state";

const tools: any[] = [];

//tool node - executes the tool calls and updates the state with the tool results
export const toolNode = new ToolNode(tools);

//reasoning node - calls the model to get the next message and updates the state with the new message
export async function callModel(state: AgentStateType) {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.5-flash",
    temperature: 0,
  }).bindTools(tools);

  const systemPrompt = new SystemMessage(
    `You are an expert astrologer and a warm, caring, and deeply insightful daily spiritual companion.
    Your mission is to guide users by computing their birth charts, analyzing real planetary data, and answering their questions with empathy, wisdom, and clarity.
    
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
