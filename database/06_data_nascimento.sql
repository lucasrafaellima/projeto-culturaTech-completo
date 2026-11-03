-- ============================================================
-- CulturaTech - Data de nascimento do sócio-leitor (US29)
-- A conta própria só é aceita a partir dos 12 anos; crianças de até
-- 11 anos usam o Espaço Kids pelo agendamento de um sócio-leitor.
-- Para bancos criados antes da coluna existir em 01_schema.sql.
-- Pode repetir sem problema. Cadastros já existentes ficam com a
-- data nula até o administrador editá-los.
-- ============================================================

SET client_encoding TO 'UTF8';

ALTER TABLE culturatech.socio_leitor ADD COLUMN IF NOT EXISTS data_nascimento DATE;
