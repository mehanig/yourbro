-- Zero-trust cleanup: deprecate public_keys table (previously used for SPIRE attestation).
-- Rename to signal deprecation; preserve data for rollback.
-- Will be dropped in a future migration after confirming no code references remain.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'public_keys')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'public_keys_deprecated') THEN
        ALTER TABLE public_keys RENAME TO public_keys_deprecated;
    END IF;
END
$$;
