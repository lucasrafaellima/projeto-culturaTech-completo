-- ============================================================
-- CulturaTech - Espaço infantil e agendamento para criança (US28)
-- Para bancos criados antes destas colunas existirem em 01_schema.sql.
-- Num banco novo não é necessário (mas é inofensivo). Pode repetir sem problema.
-- ============================================================

SET client_encoding TO 'UTF8';
SET search_path TO culturatech, public;

BEGIN;

ALTER TABLE socio_leitor ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE mesa_estudo ADD COLUMN IF NOT EXISTS espaco VARCHAR(8) NOT NULL DEFAULT 'estudo';
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS crianca_nome VARCHAR(150);
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS crianca_idade SMALLINT;
ALTER TABLE fila_espera ADD COLUMN IF NOT EXISTS crianca_nome VARCHAR(150);
ALTER TABLE fila_espera ADD COLUMN IF NOT EXISTS crianca_idade SMALLINT;

ALTER TABLE socio_leitor DROP CONSTRAINT IF EXISTS socio_leitor_data_nascimento_check;
ALTER TABLE socio_leitor ADD CONSTRAINT socio_leitor_data_nascimento_check
    CHECK (data_nascimento >= DATE '1900-01-01');
ALTER TABLE mesa_estudo DROP CONSTRAINT IF EXISTS mesa_estudo_espaco_check;
ALTER TABLE mesa_estudo ADD CONSTRAINT mesa_estudo_espaco_check CHECK (espaco IN ('estudo', 'infantil'));
ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS ck_agendamento_crianca;
ALTER TABLE agendamento ADD CONSTRAINT ck_agendamento_crianca CHECK (
    crianca_idade IS NULL OR (crianca_nome IS NOT NULL AND crianca_idade BETWEEN 0 AND 11));
ALTER TABLE fila_espera DROP CONSTRAINT IF EXISTS ck_fila_crianca;
ALTER TABLE fila_espera ADD CONSTRAINT ck_fila_crianca CHECK (
    crianca_idade IS NULL OR (crianca_nome IS NOT NULL AND crianca_idade BETWEEN 0 AND 11));

DROP INDEX IF EXISTS ux_agendamento_socio_dia;
CREATE UNIQUE INDEX ux_agendamento_socio_dia ON agendamento (socio_id, data)
    WHERE status = 'confirmado' AND crianca_nome IS NULL;
DROP INDEX IF EXISTS ux_agendamento_crianca_dia;
CREATE UNIQUE INDEX ux_agendamento_crianca_dia ON agendamento (socio_id, data, lower(crianca_nome))
    WHERE status = 'confirmado' AND crianca_nome IS NOT NULL;
DROP INDEX IF EXISTS ux_fila_socio_turno;
CREATE UNIQUE INDEX ux_fila_socio_turno ON fila_espera (socio_id, data, turno, lower(COALESCE(crianca_nome, '')))
    WHERE status = 'aguardando';

-- Dados fictícios: mesas do espaço infantil e parceiros
INSERT INTO mesa_estudo (nome, local, espaco) VALUES
    ('Mesa Infantil 1', 'Espaço infantil', 'infantil'),
    ('Mesa Infantil 2', 'Espaço infantil', 'infantil')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO instituicao (tipo, nome, documento, endereco, contato) VALUES
    ('instituicao', 'Escola Estadual Exemplo', '12345678000195', 'Rua da Escola, 10 - Centro, Arapiraca/AL',
     'secretaria@escola.example.com'),
    ('instituicao', 'Instituto Cultural Exemplo', '11222333000181', 'Avenida Deputada Ceci Cunha, 200 - Arapiraca/AL',
     'contato@instituto.example.com'),
    ('pessoa_fisica', 'Carlos Doador', '11144477735', 'Rua das Flores, 5 - Arapiraca/AL', '82988887777')
ON CONFLICT (documento) DO NOTHING;

-- Contas de demonstração (mesmos CPFs de 02_dados_exemplo.sql), para testar o agendamento para criança
UPDATE socio_leitor SET data_nascimento = '1985-04-12' WHERE cpf = '52998224725' AND data_nascimento IS NULL;
UPDATE socio_leitor SET data_nascimento = '1992-09-03' WHERE cpf = '15350946056' AND data_nascimento IS NULL;
UPDATE socio_leitor SET data_nascimento = '1998-01-25' WHERE cpf = '71460238001' AND data_nascimento IS NULL;
UPDATE socio_leitor SET data_nascimento = '2001-11-30' WHERE cpf = '38561392061' AND data_nascimento IS NULL;

COMMIT;
