-- Just run this whole file in sql editor
-- 1. Create the User Profiles table (Auth detached for local testing)
CREATE TABLE public.user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    time_of_birth TEXT NOT NULL, 
    place_of_birth TEXT NOT NULL,
    latitude DOUBLE PRECISION,   
    longitude DOUBLE PRECISION,  
    timezone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. Create the Chat Sessions table linked to User Profiles
CREATE TABLE public.chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
    title TEXT DEFAULT 'New Astrological Reading' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 3. Create the LangGraph Checkpoints table linked to Chat Sessions
CREATE TABLE public.langgraph_checkpoints (
    thread_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE PRIMARY KEY,
    checkpoint_data BYTEA NOT NULL,
    message_history JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 4. Create an automated trigger to update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_checkpoint_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_checkpoint_timestamp
BEFORE UPDATE ON public.langgraph_checkpoints
FOR EACH ROW
EXECUTE FUNCTION update_checkpoint_timestamp();