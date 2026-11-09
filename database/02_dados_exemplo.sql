-- ============================================================
-- CulturaTech - Dados de exemplo
-- Mesmas contas e cenários de demonstração do README:
--   admin / admin123
--   Maria Joana    (529.982.247-25) devolução atrasada + multa: bloqueada
--   João Pedro     (153.509.460-56) regular, reserva + empréstimo vencendo em 2 dias
--   Ana Beatriz    (714.602.380-01) multa com justificativa em análise
--   Pedro Henrique (385.613.920-61) sem e-mail: falha de notificação
--   Lucas Ferreira (861.904.237-87) 14 anos: não agenda para criança (US28)
-- Senha dos sócios: 123456. Datas relativas ao dia da carga.
-- Execute depois de 01_schema.sql.
-- ============================================================

SET client_encoding TO 'UTF8';
SET search_path TO culturatech, public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public; -- crypt() / bcrypt

BEGIN;

-- Usuários ---------------------------------------------------
INSERT INTO administrador (id, nome, matricula, usuario, senha_hash) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Administração da Biblioteca', 'ADM-001', 'admin',
     public.crypt('admin123', public.gen_salt('bf')));

INSERT INTO socio_leitor (id, nome, cpf, rg, telefone, email, endereco_rua, endereco_numero,
                          endereco_bairro, endereco_cep, senha_hash, data_cadastro, consentimento_lgpd,
                          data_nascimento) VALUES
    ('50000000-0000-0000-0000-000000000001', 'Maria Joana da Silva', '52998224725', '1234567', '82999990001',
     'maria.joana@example.com', 'Rua São Francisco', '120', 'Centro', '57300000',
     public.crypt('123456', public.gen_salt('bf')), CURRENT_DATE - 200, CURRENT_DATE - 200, '1985-04-12'),
    ('50000000-0000-0000-0000-000000000002', 'João Pedro Santos', '15350946056', '2345678', '82999990002',
     'joao.pedro@example.com', 'Avenida Rio Branco', '45', 'Baixa Grande', '57307000',
     public.crypt('123456', public.gen_salt('bf')), CURRENT_DATE - 150, CURRENT_DATE - 150, '1992-09-03'),
    ('50000000-0000-0000-0000-000000000003', 'Ana Beatriz Lima', '71460238001', '3456789', '82999990003',
     'ana.beatriz@example.com', 'Rua Expedicionários', '300', 'Eldorado', '57306000',
     public.crypt('123456', public.gen_salt('bf')), CURRENT_DATE - 100, CURRENT_DATE - 100, '1998-01-25'),
    ('50000000-0000-0000-0000-000000000004', 'Pedro Henrique Costa', '38561392061', '4567890', '82999990004',
     NULL, 'Rua Domingos Correia', '78', 'Primavera', '57304000',
     public.crypt('123456', public.gen_salt('bf')), CURRENT_DATE - 60, CURRENT_DATE - 60, '2001-11-30'),
    ('50000000-0000-0000-0000-000000000005', 'Lucas Ferreira Lima', '86190423787', NULL, '82999990005',
     'lucas.ferreira@example.com', 'Rua Santa Luzia', '15', 'Centro', '57300000',
     public.crypt('123456', public.gen_salt('bf')), CURRENT_DATE - 30, CURRENT_DATE - 30,
     (CURRENT_DATE - INTERVAL '14 years')::date);

-- Acervo -----------------------------------------------------
INSERT INTO autor (id, nome) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Graciliano Ramos'),
    ('c0000000-0000-0000-0000-000000000002', 'Rachel de Queiroz'),
    ('c0000000-0000-0000-0000-000000000003', 'Jorge Amado'),
    ('c0000000-0000-0000-0000-000000000004', 'Monteiro Lobato'),
    ('c0000000-0000-0000-0000-000000000005', 'Leandro Gomes de Barros');

INSERT INTO livro (id, titulo, editora, edicao, ano, categoria, secao, isbn, sinopse) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Vidas Secas', 'Record', '120ª', 2013, 'literatura', 'L',
     '9788501044458', 'A saga de uma família de retirantes no sertão nordestino.'),
    ('b0000000-0000-0000-0000-000000000002', 'O Quinze', 'José Olympio', '100ª', 2016, 'literatura', 'L',
     '9788503012690', 'A seca de 1915 no Ceará.'),
    ('b0000000-0000-0000-0000-000000000003', 'Capitães da Areia', 'Companhia das Letras', '1ª', 2008, 'literatura', 'L',
     '9788535911695', NULL),
    ('b0000000-0000-0000-0000-000000000004', 'Reinações de Narizinho', 'Globinho', '2ª', 2019, 'infantil', 'I',
     '9788525066473', NULL),
    ('b0000000-0000-0000-0000-000000000005', 'A Peleja do Diabo com o Dono do Céu', 'Edição do autor', '1ª', 1950, 'cordel', 'C',
     NULL, 'Folheto de cordel - consulta local.');

INSERT INTO livro_autor (livro_id, autor_id, ordem) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1),
    ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1),
    ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 1),
    ('b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 1),
    ('b0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 1);

INSERT INTO exemplar (id, livro_id, tombamento, status, data_entrada) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'BM-000001', 'disponivel', '2020-03-10'),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'BM-000002', 'disponivel', '2020-03-10'),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'BM-000003', 'disponivel', '2021-05-02'),
    ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'BM-000004', 'em_restauro', '2021-05-02'),
    ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003', 'BM-000005', 'disponivel', '2019-08-21'),
    ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', 'BM-000006', 'ocioso', '2010-01-15'),
    ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000004', 'BM-000007', 'disponivel', '2022-02-14'),
    ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'BM-000008', 'disponivel', '2022-02-14'),
    ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000005', 'BM-000009', 'disponivel', '2005-06-30'),
    -- um entrou por aquisição e outro saiu por doação (ver "Parcerias")
    ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000004', 'BM-000010', 'disponivel', CURRENT_DATE - 60),
    ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000005', 'BM-000011', 'disponivel', '2018-07-09');

-- Circulação -------------------------------------------------
-- Ordem importa: os triggers validam RN01/RN08 no momento do INSERT.

-- Maria: empréstimo ativo em atraso há 6 dias
INSERT INTO emprestimo (id, socio_id, exemplar_id, data_emprestimo, data_prevista) VALUES
    ('f0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
     'e0000000-0000-0000-0000-000000000001', CURRENT_DATE - 20, CURRENT_DATE - 6);

-- João: empréstimo vencendo em 2 dias (renovado uma vez) e uma reserva
INSERT INTO emprestimo (id, socio_id, exemplar_id, data_emprestimo, data_prevista, renovacoes) VALUES
    ('f0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002',
     'e0000000-0000-0000-0000-000000000003', CURRENT_DATE - 26, CURRENT_DATE + 2, 1);
INSERT INTO emprestimo_evento (emprestimo_id, data, texto) VALUES
    ('f0000000-0000-0000-0000-000000000002', now() - interval '26 days', 'Empréstimo registrado.'),
    ('f0000000-0000-0000-0000-000000000002', now() - interval '12 days', 'Renovação 1 de 3: novo prazo em +14 dias.');
INSERT INTO reserva (socio_id, exemplar_id, data_reserva, expira_em) VALUES
    ('50000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000007', CURRENT_DATE, CURRENT_DATE + 3);

-- Pedro: empréstimo vencendo amanhã; cadastro sem e-mail
INSERT INTO emprestimo (id, socio_id, exemplar_id, data_emprestimo, data_prevista) VALUES
    ('f0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000004',
     'e0000000-0000-0000-0000-000000000005', CURRENT_DATE - 13, CURRENT_DATE + 1);
INSERT INTO notificacao (socio_id, emprestimo_id, tipo, referencia, destinatario, assunto, corpo, status, motivo_falha) VALUES
    ('50000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000003', 'lembrete',
     CURRENT_DATE + 1, '(sem e-mail)', 'Lembrete: devolução de "Capitães da Areia"',
     'Olá, Pedro! O prazo de devolução do livro "Capitães da Areia" termina amanhã.',
     'falha', 'Cadastro sem e-mail válido. Atualize o cadastro do sócio-leitor.');

-- Históricos já devolvidos (não passam pela validação de empréstimo novo)
INSERT INTO emprestimo (id, socio_id, exemplar_id, data_emprestimo, data_prevista, data_devolucao, status) VALUES
    ('f0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001',
     'e0000000-0000-0000-0000-000000000008', CURRENT_DATE - 60, CURRENT_DATE - 46, CURRENT_DATE - 42, 'devolvido'),
    ('f0000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000003',
     'e0000000-0000-0000-0000-000000000002', CURRENT_DATE - 40, CURRENT_DATE - 26, CURRENT_DATE - 21, 'devolvido');

-- Maria: multa de atraso pendente (4 dias)
INSERT INTO multa (socio_id, emprestimo_id, valor, motivo, status, dias, data) VALUES
    ('50000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004',
     4.00, 'atraso', 'pendente', 4, CURRENT_DATE - 42);

-- Ana: multa de atraso com justificativa aguardando julgamento (RN07)
INSERT INTO multa (socio_id, emprestimo_id, valor, motivo, status, dias, data,
                   justificativa_texto, justificativa_data) VALUES
    ('50000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000005',
     5.00, 'atraso', 'em_analise', 5, CURRENT_DATE - 21,
     'Estive internada no hospital durante a semana do vencimento; tenho atestado médico.',
     now() - interval '20 days');

-- Desbastamento de exemplar ocioso (RN31)
INSERT INTO desbaste (exemplar_id, admin_id, status_anterior, relatorio) VALUES
    ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'ocioso',
     'Exemplar sem empréstimos há mais de dez anos e com outro exemplar disponível no acervo.');
UPDATE exemplar SET baixa_data = CURRENT_DATE, baixa_motivo = 'desbaste'
 WHERE id = 'e0000000-0000-0000-0000-000000000006';

-- Mesas de estudo --------------------------------------------
INSERT INTO mesa_estudo (id, nome, local) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Mesa 1', 'Salão de leitura'),
    ('d0000000-0000-0000-0000-000000000002', 'Mesa 2', 'Salão de leitura'),
    ('d0000000-0000-0000-0000-000000000003', 'Mesa 3', 'Sala de estudos');
INSERT INTO mesa_estudo (id, nome, local, espaco) VALUES
    ('d0000000-0000-0000-0000-000000000004', 'Mesa Infantil 1', 'Espaço infantil', 'infantil'),
    ('d0000000-0000-0000-0000-000000000005', 'Mesa Infantil 2', 'Espaço infantil', 'infantil');

INSERT INTO agendamento (mesa_id, socio_id, data, turno) VALUES
    ('d0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', CURRENT_DATE + 1, 'manha'),
    ('d0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', CURRENT_DATE + 1, 'manha'),
    ('d0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000004', CURRENT_DATE + 1, 'manha');

INSERT INTO fila_espera (socio_id, data, turno) VALUES
    ('50000000-0000-0000-0000-000000000001', CURRENT_DATE + 1, 'manha');

-- Espaço infantil lotado à tarde, com uma criança na fila (US28)
INSERT INTO agendamento (mesa_id, socio_id, data, turno, crianca_nome, crianca_idade) VALUES
    ('d0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', CURRENT_DATE + 1, 'tarde', 'Clara Santos', 7),
    ('d0000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000003', CURRENT_DATE + 1, 'tarde', 'Miguel Lima', 9);

INSERT INTO fila_espera (socio_id, data, turno, crianca_nome, crianca_idade) VALUES
    ('50000000-0000-0000-0000-000000000004', CURRENT_DATE + 1, 'tarde', 'Helena Costa', 5);

-- Parcerias --------------------------------------------------
INSERT INTO instituicao (id, tipo, nome, documento, endereco, contato) VALUES
    ('90000000-0000-0000-0000-000000000001', 'instituicao', 'Escola Estadual Exemplo', '12345678000195',
     'Rua da Escola, 10 - Centro, Arapiraca/AL', 'secretaria@escola.example.com'),
    ('90000000-0000-0000-0000-000000000002', 'pessoa_fisica', 'Carlos Doador', '11144477735',
     'Rua das Flores, 5 - Arapiraca/AL', '82988887777'),
    ('90000000-0000-0000-0000-000000000003', 'instituicao', 'Instituto Cultural Exemplo', '11222333000181',
     'Avenida Deputada Ceci Cunha, 200 - Arapiraca/AL', 'contato@instituto.example.com');

-- Aquisição: exemplar recebido do instituto
INSERT INTO movimentacao (id, tipo, livro_id, receptor_id, data, observacao) VALUES
    ('91000000-0000-0000-0000-000000000001', 'aquisicao', 'b0000000-0000-0000-0000-000000000004',
     '90000000-0000-0000-0000-000000000003', CURRENT_DATE - 60, 'Doação recebida do instituto.');
INSERT INTO movimentacao_exemplar (movimentacao_id, exemplar_id) VALUES
    ('91000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000010');

-- Doação: exemplar repassado à escola, que sai do acervo
INSERT INTO movimentacao (id, tipo, livro_id, receptor_id, data, observacao) VALUES
    ('91000000-0000-0000-0000-000000000002', 'doacao', 'b0000000-0000-0000-0000-000000000005',
     '90000000-0000-0000-0000-000000000001', CURRENT_DATE - 20, 'Reforço da biblioteca da escola.');
INSERT INTO movimentacao_exemplar (movimentacao_id, exemplar_id) VALUES
    ('91000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000011');
UPDATE exemplar SET baixa_data = CURRENT_DATE - 20, baixa_motivo = 'doacao'
 WHERE id = 'e0000000-0000-0000-0000-000000000011';

-- Mural ------------------------------------------------------
INSERT INTO publicacao (tipo, titulo, descricao, data, admin_id) VALUES
    ('evento', 'Sarau de Cordel', 'Apresentação de cordelistas da região no salão de leitura.', CURRENT_DATE + 7,
     'a0000000-0000-0000-0000-000000000001'),
    ('novidade', 'Novos títulos infantis', 'Chegaram novos exemplares de Monteiro Lobato.', CURRENT_DATE,
     'a0000000-0000-0000-0000-000000000001');

-- Repositório digital ----------------------------------------
INSERT INTO pasta_historica (id, nome, descricao) VALUES
    ('70000000-0000-0000-0000-000000000001', 'História de Arapiraca', 'Documentos e fotografias históricas do município.');

COMMIT;
