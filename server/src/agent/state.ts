import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

// 1. Sub-schema for the user's birth data
export interface BirthDetails {
  date_of_birth?: string;     
  time_of_birth?: string;     
  place_of_birth?: string;    
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

// 2. Main Graph State Annotation
export const AgentState = Annotation.Root({
  
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  
  birth_details: Annotation<BirthDetails | null>({
    value: (x, y) => y,
    default: () => null,
  }),
  
  tool_status: Annotation<string>({
    value: (x, y) => y,
    default: () => "",
  })
});

export type AgentStateType = typeof AgentState.State;