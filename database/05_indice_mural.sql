-- ============================================================
-- CulturaTech - Índice do filtro por tipo do mural (iteração 3, T10/T11)
-- Para bancos criados antes deste índice existir em 01_schema.sql.
-- Num banco novo não é necessário (mas é inofensivo).
-- ============================================================

SET client_encoding TO 'UTF8';

CREATE INDEX IF NOT EXISTS ix_publicacao_tipo_data ON culturatech.publicacao (tipo, data DESC);
