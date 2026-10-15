-- Phase 1 Foundation: Shell, Context, and Sources
-- Extends the database to support structured user sources and independent learning logs.

-- 1. Structured Sources
CREATE TABLE IF NOT EXISTS public.user_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('book', 'drive', 'portal', 'notes', 'coaching', 'other')),
    url text,
    edition text,
    is_archived boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Index for querying a user's sources
CREATE INDEX IF NOT EXISTS user_sources_user_id_idx ON public.user_sources(user_id);

-- 2. Source Mappings
CREATE TABLE IF NOT EXISTS public.source_mappings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_source_id uuid REFERENCES public.user_sources(id) ON DELETE CASCADE,
    lesson_reference text,
    mapped_module_id text REFERENCES public.learning_modules(id) ON DELETE SET NULL,
    mapping_status text NOT NULL CHECK (mapping_status IN ('unmapped', 'suggested', 'confirmed', 'verified')),
    created_at timestamptz DEFAULT now()
);

-- Index for resolving mapped modules
CREATE INDEX IF NOT EXISTS source_mappings_source_id_idx ON public.source_mappings(user_source_id);

-- 3. Learning Activities (Evidence of study decoupled from plans)
CREATE TABLE IF NOT EXISTS public.learning_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type text NOT NULL CHECK (activity_type IN ('class', 'independent_study', 'external_practice')),
    description text NOT NULL,
    lm_id text REFERENCES public.learning_modules(id) ON DELETE SET NULL, -- Optional mapping
    user_source_id uuid REFERENCES public.user_sources(id) ON DELETE SET NULL, -- Optional source link
    related_task_id text REFERENCES public.plan_blocks(id) ON DELETE SET NULL, -- Optional task link
    duration_minutes integer,
    self_reported_confidence text CHECK (self_reported_confidence IN ('low', 'medium', 'high', 'unknown', NULL)),
    created_at timestamptz DEFAULT now()
);

-- Index for retrieving learning timeline
CREATE INDEX IF NOT EXISTS learning_activities_user_id_idx ON public.learning_activities(user_id);

-- Row Level Security (enable policies assuming authenticated API endpoints handle access, 
-- or explicitly enforce RLS if accessed directly from client).
-- We assume application endpoints enforce ownership.

-- Add RLS for completeness since supabase requires it for secure client queries
ALTER TABLE public.user_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own sources" 
    ON public.user_sources FOR ALL 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage mappings for their sources" 
    ON public.source_mappings FOR ALL 
    USING (EXISTS (SELECT 1 FROM public.user_sources WHERE id = user_source_id AND user_id = auth.uid()));

CREATE POLICY "Users can manage their own learning activities" 
    ON public.learning_activities FOR ALL 
    USING (auth.uid() = user_id);
