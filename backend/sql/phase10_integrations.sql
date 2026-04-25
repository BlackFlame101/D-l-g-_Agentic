-- Phase 10: Integrations + contact memory

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('shopify', 'youcan', 'google_calendar')),
    config JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    feature_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_integrations_user_type
    ON integrations(user_id, type);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'integrations'
          AND policyname = 'Users manage own integrations'
    ) THEN
        CREATE POLICY "Users manage own integrations"
            ON integrations
            FOR ALL
            USING (auth.uid() = user_id);
    END IF;
END $$;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS contact_memory JSONB DEFAULT '{}';
