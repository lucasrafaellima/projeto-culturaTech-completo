-- ============================================================
-- CulturaTech - Localização de cada exemplar (US03)
-- Para bancos criados antes desta coluna existir em 01_schema.sql.
-- Num banco novo não é necessário (mas é inofensivo).
-- ============================================================

SET client_encoding TO 'UTF8';

ALTER TABLE culturatech.exemplar ADD COLUMN IF NOT EXISTS localizacao VARCHAR(80);
