-- Zero-trust cleanup: deprecate public_keys table (previously used for SPIRE attestation).
-- Rename to signal deprecation; preserve data for rollback.
-- Will be dropped in a future migration after confirming no code references remain.
ALTER TABLE IF EXISTS public_keys RENAME TO public_keys_deprecated;
