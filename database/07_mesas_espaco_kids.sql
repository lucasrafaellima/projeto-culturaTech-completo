-- ============================================================
-- CulturaTech - Espaço Kids (US29) e confirmação de uso (US30) no banco
-- Para bancos criados antes destas colunas existirem em 01_schema.sql.
-- Rode depois de 06_data_nascimento.sql. Num banco novo não é necessário
-- (mas é inofensivo). Pode repetir sem problema.
-- Também converte um banco em que a versão anterior deste ajuste
-- (05_mesas_espaco_infantil.sql, "espaço infantil" com a idade da criança) já rodou.
-- ============================================================

SET client_encoding TO 'UTF8';
SET search_path TO culturatech, public;

BEGIN;

-- Mesas: estudo ou Espaço Kids
ALTER TABLE mesa_estudo ADD COLUMN IF NOT EXISTS espaco VARCHAR(8) NOT NULL DEFAULT 'estudo';
ALTER TABLE mesa_estudo DROP CONSTRAINT IF EXISTS mesa_estudo_espaco_check;
UPDATE mesa_estudo SET espaco = 'kids' WHERE espaco = 'infantil';
ALTER TABLE mesa_estudo ADD CONSTRAINT mesa_estudo_espaco_check CHECK (espaco IN ('estudo', 'kids'));

-- Agendamento: criança do Espaço Kids, confirmação de uso e "não compareceu"
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS uso_confirmado_em TIMESTAMPTZ;
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS crianca_nome VARCHAR(150);
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS crianca_cpf CHAR(11);
ALTER TABLE agendamento ADD COLUMN IF NOT EXISTS crianca_nascimento DATE;
ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS ck_agendamento_crianca;
-- agendamentos de criança da versão anterior (sem CPF) ficam só com o nome
ALTER TABLE agendamento DROP COLUMN IF EXISTS crianca_idade;
ALTER TABLE agendamento ALTER COLUMN status TYPE VARCHAR(14);
ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS agendamento_status_check;
ALTER TABLE agendamento ADD CONSTRAINT agendamento_status_check
    CHECK (status IN ('confirmado', 'cancelado', 'nao_compareceu'));
ALTER TABLE agendamento DROP CONSTRAINT IF EXISTS agendamento_crianca_cpf_check;
ALTER TABLE agendamento ADD CONSTRAINT agendamento_crianca_cpf_check CHECK (crianca_cpf ~ '^[0-9]{11}$');
ALTER TABLE agendamento ADD CONSTRAINT ck_agendamento_crianca CHECK (
    (crianca_cpf IS NULL) = (crianca_nascimento IS NULL) AND (crianca_cpf IS NULL OR crianca_nome IS NOT NULL));

-- Fila: criança do Espaço Kids e "retirada"
ALTER TABLE fila_espera ADD COLUMN IF NOT EXISTS crianca_nome VARCHAR(150);
ALTER TABLE fila_espera ADD COLUMN IF NOT EXISTS crianca_cpf CHAR(11);
ALTER TABLE fila_espera ADD COLUMN IF NOT EXISTS crianca_nascimento DATE;
ALTER TABLE fila_espera DROP CONSTRAINT IF EXISTS ck_fila_crianca;
-- entradas de criança da versão anterior (sem CPF) não têm como ser atendidas
UPDATE fila_espera SET status = 'desistiu' WHERE status = 'aguardando' AND crianca_nome IS NOT NULL AND crianca_cpf IS NULL;
ALTER TABLE fila_espera DROP COLUMN IF EXISTS crianca_idade;
ALTER TABLE fila_espera DROP CONSTRAINT IF EXISTS fila_espera_status_check;
ALTER TABLE fila_espera ADD CONSTRAINT fila_espera_status_check
    CHECK (status IN ('aguardando', 'contemplado', 'desistiu', 'expirada', 'retirada'));
ALTER TABLE fila_espera DROP CONSTRAINT IF EXISTS fila_espera_crianca_cpf_check;
ALTER TABLE fila_espera ADD CONSTRAINT fila_espera_crianca_cpf_check CHECK (crianca_cpf ~ '^[0-9]{11}$');
ALTER TABLE fila_espera ADD CONSTRAINT ck_fila_crianca CHECK (
    (crianca_cpf IS NULL) = (crianca_nascimento IS NULL) AND (crianca_cpf IS NULL OR crianca_nome IS NOT NULL));

-- Índices: RN05 do sócio (sem criança), RN05 da criança (pelo CPF) e fila
DROP INDEX IF EXISTS ux_agendamento_socio_dia;
CREATE UNIQUE INDEX ux_agendamento_socio_dia ON agendamento (socio_id, data)
    WHERE status = 'confirmado' AND crianca_nome IS NULL;
DROP INDEX IF EXISTS ux_agendamento_crianca_dia;
CREATE UNIQUE INDEX ux_agendamento_crianca_dia ON agendamento (crianca_cpf, data)
    WHERE status = 'confirmado' AND crianca_cpf IS NOT NULL;
DROP INDEX IF EXISTS ux_fila_socio_turno;
CREATE UNIQUE INDEX ux_fila_socio_turno ON fila_espera (socio_id, data, turno, COALESCE(crianca_cpf, ''))
    WHERE status = 'aguardando';

-- Dados fictícios: mesas do Espaço Kids e parceiros
UPDATE mesa_estudo SET nome = 'Mesa Kids 1', local = 'Espaço Kids' WHERE nome = 'Mesa Infantil 1'
   AND NOT EXISTS (SELECT 1 FROM mesa_estudo WHERE nome = 'Mesa Kids 1');
UPDATE mesa_estudo SET nome = 'Mesa Kids 2', local = 'Espaço Kids' WHERE nome = 'Mesa Infantil 2'
   AND NOT EXISTS (SELECT 1 FROM mesa_estudo WHERE nome = 'Mesa Kids 2');
INSERT INTO mesa_estudo (nome, local, espaco) VALUES
    ('Mesa Kids 1', 'Espaço Kids', 'kids'),
    ('Mesa Kids 2', 'Espaço Kids', 'kids')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO instituicao (tipo, nome, documento, endereco, contato) VALUES
    ('instituicao', 'Escola Estadual Exemplo', '12345678000195', 'Rua da Escola, 10 - Centro, Arapiraca/AL',
     'secretaria@escola.example.com'),
    ('instituicao', 'Instituto Cultural Exemplo', '11222333000181', 'Avenida Deputada Ceci Cunha, 200 - Arapiraca/AL',
     'contato@instituto.example.com'),
    ('pessoa_fisica', 'Carlos Doador', '11144477735', 'Rua das Flores, 5 - Arapiraca/AL', '82988887777')
ON CONFLICT (documento) DO NOTHING;

COMMIT;
