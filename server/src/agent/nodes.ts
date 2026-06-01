import { AIMessage } from "@langchain/core/messages";
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

  const { messages } = state;
  const response = await model.invoke(messages);

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
