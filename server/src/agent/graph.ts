import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { callModel, toolNode, shouldContinue } from "./nodes";

const workflow = new StateGraph(AgentState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

export const app = workflow.compile();
