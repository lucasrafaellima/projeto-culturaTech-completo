-- ============================================================
-- CulturaTech - Modelo físico do banco de dados
-- SGBD: PostgreSQL 16 (Amazon RDS)
-- Baseado em src/lib/types.ts, src/lib/constants.ts e no diagrama
-- de classes. Numeração de RF/RN/RNF conforme o Documento de
-- Requisitos v3.2.
--
-- Convenções:
--   - chaves primárias UUID geradas pelo banco (gen_random_uuid)
--   - domínios (status, categorias, turnos...) em VARCHAR + CHECK,
--     com os mesmos valores usados no front-end
--   - datas sem hora em DATE; instantes em TIMESTAMPTZ
--   - regras que dependem de vários registros (ex.: RN01) ficam em
--     triggers; as demais, em CHECK e índices únicos parciais
--   - funções fixam o próprio search_path, para funcionarem em
--     qualquer conexão (psql, API) sem depender da configuração dela
-- ============================================================

SET client_encoding TO 'UTF8'; -- acentos corretos no psql do Windows
CREATE SCHEMA IF NOT EXISTS culturatech;
SET search_path TO culturatech;

-- ------------------------------------------------------------
-- Arquivos (imagens e PDFs)
-- Os bytes ficam no Amazon S3; o banco guarda só os metadados e a
-- chave do objeto. Substitui o IndexedDB do protótipo (RNF12/RNF13).
-- ------------------------------------------------------------
CREATE TABLE arquivo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_arquivo        VARCHAR(255) NOT NULL,
    mime                VARCHAR(100) NOT NULL
                        CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png', 'application/pdf')),
    chave_storage       VARCHAR(500) NOT NULL UNIQUE, -- chave no S3: <pasta>/<uuid>.<extensão>, ex.: acervo/<uuid>.pdf
    tamanho_original    BIGINT NOT NULL CHECK (tamanho_original >= 0),
    tamanho_armazenado  BIGINT NOT NULL CHECK (tamanho_armazenado >= 0),
    compressao          VARCHAR(10) NOT NULL DEFAULT 'nenhuma'
                        CHECK (compressao IN ('gzip', 'webp', 'nenhuma')),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Usuários
-- O diagrama modela Usuario como superclasse; aqui cada perfil tem
-- a sua tabela, como no protótipo, porque os dados e a forma de
-- login diferem (administrador: usuário; sócio: CPF ou e-mail).
-- ------------------------------------------------------------
CREATE TABLE administrador (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(150) NOT NULL,
    matricula   VARCHAR(30) UNIQUE,
    usuario     VARCHAR(60) NOT NULL,
    senha_hash  VARCHAR(255) NOT NULL, -- bcrypt/argon2 gerado pelo back-end
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_administrador_usuario ON administrador (lower(usuario));

-- Sócio-leitor (RF02)
CREATE TABLE socio_leitor (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                VARCHAR(150) NOT NULL,
    -- CPF, RG, contato e endereço ficam nulos após a anonimização (LGPD)
    cpf                 CHAR(11) CHECK (cpf ~ '^[0-9]{11}$'),
    rg                  VARCHAR(20),
    telefone            VARCHAR(20),
    email               VARCHAR(254),
    foto_arquivo_id     UUID REFERENCES arquivo (id) ON DELETE SET NULL,
    endereco_rua        VARCHAR(150),
    endereco_numero     VARCHAR(10),
    endereco_bairro     VARCHAR(80),
    endereco_cep        CHAR(8) CHECK (endereco_cep ~ '^[0-9]{8}$'),
    senha_hash          VARCHAR(255),
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    data_cadastro       DATE NOT NULL DEFAULT CURRENT_DATE,
    consentimento_lgpd  DATE, -- RNF06: nulo = pendente (cadastro migrado)
    anonimizado         BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_socio_identificado CHECK (anonimizado OR cpf IS NOT NULL)
);
CREATE UNIQUE INDEX ux_socio_cpf ON socio_leitor (cpf) WHERE cpf IS NOT NULL;
CREATE UNIQUE INDEX ux_socio_email ON socio_leitor (lower(email)) WHERE email IS NOT NULL;

-- ------------------------------------------------------------
-- Acervo: autores, obras e exemplares (RF01 / RF16)
-- ------------------------------------------------------------
CREATE TABLE autor (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome  VARCHAR(150) NOT NULL -- ordem direta; a forma catalográfica é derivada (RN19)
);
CREATE INDEX ix_autor_nome ON autor (lower(nome));

CREATE TABLE livro (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo     VARCHAR(300) NOT NULL,
    editora    VARCHAR(150) NOT NULL,
    edicao     VARCHAR(30) NOT NULL,
    ano        SMALLINT NOT NULL CHECK (ano BETWEEN 1400 AND 2100),
    categoria  VARCHAR(20) NOT NULL
               CHECK (categoria IN ('literatura', 'infantil', 'didatico', 'historia',
                                    'ciencias', 'cordel', 'raro', 'exemplar_unico')),
    secao      CHAR(1) NOT NULL CHECK (secao ~ '^[A-Z]$'), -- RN22
    isbn       VARCHAR(17),
    sinopse    TEXT,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_livro_titulo ON livro (lower(titulo));
CREATE INDEX ix_livro_isbn ON livro (isbn);
CREATE INDEX ix_livro_categoria ON livro (categoria);

-- RN18: múltiplos autores; ordem = 1 é a entrada principal (RN19)
CREATE TABLE livro_autor (
    livro_id  UUID NOT NULL REFERENCES livro (id) ON DELETE CASCADE,
    autor_id  UUID NOT NULL REFERENCES autor (id) ON DELETE RESTRICT,
    ordem     SMALLINT NOT NULL CHECK (ordem >= 1),
    PRIMARY KEY (livro_id, autor_id),
    UNIQUE (livro_id, ordem)
);
CREATE INDEX ix_livro_autor_autor ON livro_autor (autor_id);

-- Exemplar físico (RF16). O id é o código de identificação (RN20).
-- Exemplares baixados (desbaste/doação) não são apagados, para manter
-- o histórico de empréstimos.
CREATE TABLE exemplar (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    livro_id      UUID NOT NULL REFERENCES livro (id) ON DELETE RESTRICT,
    tombamento    VARCHAR(30) NOT NULL UNIQUE,
    status        VARCHAR(15) NOT NULL DEFAULT 'disponivel' -- RN12
                  CHECK (status IN ('disponivel', 'reservado', 'em_restauro', 'indisponivel',
                                    'extraviado', 'ocioso', 'danificado')),
    data_entrada  DATE NOT NULL DEFAULT CURRENT_DATE,
    localizacao   VARCHAR(80), -- onde a cópia fica (ex.: Estante 3, prateleira B)
    baixa_data    DATE,
    baixa_motivo  VARCHAR(10) CHECK (baixa_motivo IN ('desbaste', 'doacao')),
    CONSTRAINT ck_exemplar_baixa CHECK ((baixa_data IS NULL) = (baixa_motivo IS NULL))
);
CREATE INDEX ix_exemplar_livro ON exemplar (livro_id);

-- Desbastamento (RN24 / RN31)
CREATE TABLE desbaste (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exemplar_id      UUID NOT NULL UNIQUE REFERENCES exemplar (id),
    admin_id         UUID REFERENCES administrador (id),
    status_anterior  VARCHAR(15) NOT NULL CHECK (status_anterior IN ('ocioso', 'danificado')),
    relatorio        TEXT NOT NULL CHECK (char_length(relatorio) >= 20),
    data             DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ------------------------------------------------------------
-- Circulação: empréstimos, multas, danos e reservas
-- ------------------------------------------------------------
CREATE TABLE emprestimo (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id               UUID NOT NULL REFERENCES socio_leitor (id),
    exemplar_id            UUID NOT NULL REFERENCES exemplar (id),
    data_emprestimo        DATE NOT NULL DEFAULT CURRENT_DATE,  -- RF07
    data_prevista          DATE NOT NULL,                       -- RN02: +14 dias por período
    data_devolucao         DATE,                                -- RF07
    renovacoes             SMALLINT NOT NULL DEFAULT 0 CHECK (renovacoes BETWEEN 0 AND 3), -- RN17
    status                 VARCHAR(10) NOT NULL DEFAULT 'ativo'
                           CHECK (status IN ('ativo', 'devolvido', 'cancelado')),
    motivo_cancelamento    TEXT,
    devolvido_danificado   BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_emprestimo_prazo CHECK (data_prevista >= data_emprestimo),
    CONSTRAINT ck_emprestimo_devolucao CHECK ((status = 'devolvido') = (data_devolucao IS NOT NULL)),
    CONSTRAINT ck_emprestimo_cancelamento CHECK (status <> 'cancelado' OR motivo_cancelamento IS NOT NULL)
);
-- um exemplar só pode ter um empréstimo ativo por vez
CREATE UNIQUE INDEX ux_emprestimo_exemplar_ativo ON emprestimo (exemplar_id) WHERE status = 'ativo';
CREATE INDEX ix_emprestimo_socio ON emprestimo (socio_id, status);
CREATE INDEX ix_emprestimo_prevista_ativo ON emprestimo (data_prevista) WHERE status = 'ativo';

-- Histórico de renovações e alterações de um empréstimo (RF03)
CREATE TABLE emprestimo_evento (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emprestimo_id  UUID NOT NULL REFERENCES emprestimo (id) ON DELETE CASCADE,
    data           TIMESTAMPTZ NOT NULL DEFAULT now(),
    texto          TEXT NOT NULL
);
CREATE INDEX ix_emprestimo_evento ON emprestimo_evento (emprestimo_id, data);

-- Multas (RN03 atraso / RF15 dano)
CREATE TABLE multa (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id             UUID NOT NULL REFERENCES socio_leitor (id),
    emprestimo_id        UUID NOT NULL REFERENCES emprestimo (id),
    valor                NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    motivo               VARCHAR(10) NOT NULL CHECK (motivo IN ('atraso', 'dano')),
    status               VARCHAR(12) NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente', 'em_analise', 'paga', 'abonada')),
    dias                 INTEGER CHECK (dias > 0),
    data                 DATE NOT NULL DEFAULT CURRENT_DATE,
    -- RN07: justificativa registrada pelo sócio-leitor
    justificativa_texto  TEXT CHECK (justificativa_texto IS NULL OR char_length(justificativa_texto) >= 20),
    justificativa_data   TIMESTAMPTZ,
    data_quitacao        DATE,
    CONSTRAINT ck_multa_dias CHECK (motivo <> 'atraso' OR dias IS NOT NULL),
    CONSTRAINT ck_multa_justificativa CHECK ((justificativa_texto IS NULL) = (justificativa_data IS NULL)),
    CONSTRAINT ck_multa_em_analise CHECK (status <> 'em_analise' OR justificativa_texto IS NOT NULL),
    CONSTRAINT ck_multa_quitacao CHECK ((status IN ('paga', 'abonada')) = (data_quitacao IS NOT NULL))
);
CREATE INDEX ix_multa_socio_aberta ON multa (socio_id) WHERE status IN ('pendente', 'em_analise');
CREATE UNIQUE INDEX ux_multa_atraso_emprestimo ON multa (emprestimo_id) WHERE motivo = 'atraso';

-- RN07: julgamentos do administrador sobre uma justificativa
CREATE TABLE parecer_multa (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    multa_id       UUID NOT NULL REFERENCES multa (id) ON DELETE CASCADE,
    admin_id       UUID NOT NULL REFERENCES administrador (id),
    decisao        VARCHAR(10) NOT NULL CHECK (decisao IN ('deferido', 'indeferido')),
    texto          TEXT NOT NULL,
    justificativa  TEXT NOT NULL, -- cópia da justificativa julgada
    data           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_parecer_multa ON parecer_multa (multa_id, data);

-- Ocorrência de dano (RF15)
CREATE TABLE ocorrencia_dano (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emprestimo_id  UUID NOT NULL UNIQUE REFERENCES emprestimo (id),
    multa_id       UUID NOT NULL UNIQUE REFERENCES multa (id),
    admin_id       UUID REFERENCES administrador (id),
    relatorio      TEXT NOT NULL,
    valor_multa    NUMERIC(10, 2) NOT NULL CHECK (valor_multa > 0), -- sugestão: R$ 25,00
    data           DATE NOT NULL DEFAULT CURRENT_DATE
);
-- exemplar e sócio são obtidos pelo empréstimo, evitando redundância

CREATE TABLE ocorrencia_dano_imagem (
    ocorrencia_id  UUID NOT NULL REFERENCES ocorrencia_dano (id) ON DELETE CASCADE,
    arquivo_id     UUID NOT NULL REFERENCES arquivo (id) ON DELETE RESTRICT,
    PRIMARY KEY (ocorrencia_id, arquivo_id)
);

-- Reserva de exemplar (RF14 / RN28): aguarda retirada por 3 dias
CREATE TABLE reserva (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id      UUID NOT NULL REFERENCES socio_leitor (id),
    exemplar_id   UUID NOT NULL REFERENCES exemplar (id),
    data_reserva  DATE NOT NULL DEFAULT CURRENT_DATE,
    expira_em     DATE NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa', 'retirada', 'cancelada', 'expirada')),
    CONSTRAINT ck_reserva_prazo CHECK (expira_em >= data_reserva)
);
CREATE UNIQUE INDEX ux_reserva_exemplar_ativa ON reserva (exemplar_id) WHERE status = 'ativa';
CREATE INDEX ix_reserva_socio ON reserva (socio_id, status);

-- Notificações por e-mail (RF05) - caixa de saída
CREATE TABLE notificacao (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id       UUID NOT NULL REFERENCES socio_leitor (id),
    emprestimo_id  UUID NOT NULL REFERENCES emprestimo (id),
    tipo           VARCHAR(10) NOT NULL CHECK (tipo IN ('lembrete', 'vencimento', 'atraso')),
    referencia     DATE NOT NULL, -- data prevista a que o aviso se refere
    destinatario   VARCHAR(254) NOT NULL,
    assunto        VARCHAR(300) NOT NULL,
    corpo          TEXT NOT NULL,
    data           TIMESTAMPTZ NOT NULL DEFAULT now(),
    status         VARCHAR(8) NOT NULL CHECK (status IN ('enviado', 'falha')),
    motivo_falha   TEXT,
    tratada_em     TIMESTAMPTZ,
    -- cada aviso é enviado uma única vez por prazo
    UNIQUE (emprestimo_id, tipo, referencia),
    CONSTRAINT ck_notificacao_falha CHECK (status <> 'falha' OR motivo_falha IS NOT NULL)
);
CREATE INDEX ix_notificacao_falha ON notificacao (data) WHERE status = 'falha' AND tratada_em IS NULL;

-- ------------------------------------------------------------
-- Mesas de estudo (RF10 / RF11)
-- Turnos: manhã 08h-12h, tarde 13h-17h, noite 18h-21h
-- ------------------------------------------------------------
CREATE TABLE mesa_estudo (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome   VARCHAR(60) NOT NULL UNIQUE,
    local  VARCHAR(120) NOT NULL,
    ativa  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE agendamento (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mesa_id    UUID NOT NULL REFERENCES mesa_estudo (id),
    socio_id   UUID NOT NULL REFERENCES socio_leitor (id),
    data       DATE NOT NULL,
    turno      VARCHAR(5) NOT NULL CHECK (turno IN ('manha', 'tarde', 'noite')),
    status     VARCHAR(10) NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'cancelado')),
    origem     VARCHAR(6) NOT NULL DEFAULT 'direto' CHECK (origem IN ('direto', 'fila')),
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- uma mesa por turno
CREATE UNIQUE INDEX ux_agendamento_mesa_turno ON agendamento (mesa_id, data, turno) WHERE status = 'confirmado';
-- RN05: um agendamento confirmado por sócio por dia
CREATE UNIQUE INDEX ux_agendamento_socio_dia ON agendamento (socio_id, data) WHERE status = 'confirmado';

-- Fila de espera (RF11): a ordem é dada por criado_em
CREATE TABLE fila_espera (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    socio_id        UUID NOT NULL REFERENCES socio_leitor (id),
    data            DATE NOT NULL,
    turno           VARCHAR(5) NOT NULL CHECK (turno IN ('manha', 'tarde', 'noite')),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(12) NOT NULL DEFAULT 'aguardando'
                    CHECK (status IN ('aguardando', 'contemplado', 'desistiu', 'expirada')),
    agendamento_id  UUID UNIQUE REFERENCES agendamento (id),
    CONSTRAINT ck_fila_contemplado CHECK ((status = 'contemplado') = (agendamento_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_fila_socio_turno ON fila_espera (socio_id, data, turno) WHERE status = 'aguardando';
CREATE INDEX ix_fila_ordem ON fila_espera (data, turno, criado_em) WHERE status = 'aguardando';

-- ------------------------------------------------------------
-- Parcerias e movimentações do acervo (RF13 / RN25 / RN26)
-- ------------------------------------------------------------
CREATE TABLE instituicao (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo       VARCHAR(13) NOT NULL CHECK (tipo IN ('instituicao', 'pessoa_fisica')),
    nome       VARCHAR(150) NOT NULL,
    documento  VARCHAR(14) NOT NULL UNIQUE, -- CNPJ (14 dígitos) ou CPF (11 dígitos)
    endereco   VARCHAR(250) NOT NULL,
    contato    VARCHAR(150) NOT NULL,
    CONSTRAINT ck_instituicao_documento CHECK (
        (tipo = 'instituicao' AND documento ~ '^[0-9]{14}$') OR
        (tipo = 'pessoa_fisica' AND documento ~ '^[0-9]{11}$')
    )
);

-- doação: exemplares saem do acervo; aquisição: exemplares entram
CREATE TABLE movimentacao (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo         VARCHAR(9) NOT NULL CHECK (tipo IN ('doacao', 'aquisicao')),
    livro_id     UUID NOT NULL REFERENCES livro (id),
    receptor_id  UUID NOT NULL REFERENCES instituicao (id),
    data         DATE NOT NULL DEFAULT CURRENT_DATE,
    observacao   TEXT
);
CREATE INDEX ix_movimentacao_receptor ON movimentacao (receptor_id, tipo);

CREATE TABLE movimentacao_exemplar (
    movimentacao_id  UUID NOT NULL REFERENCES movimentacao (id) ON DELETE CASCADE,
    exemplar_id      UUID NOT NULL REFERENCES exemplar (id),
    PRIMARY KEY (movimentacao_id, exemplar_id)
);

-- ------------------------------------------------------------
-- Repositório digital (RF08 / RF17)
-- ------------------------------------------------------------
CREATE TABLE pasta_historica (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       VARCHAR(120) NOT NULL UNIQUE,
    descricao  TEXT NOT NULL DEFAULT ''
);

-- Documento digital vinculado a uma obra OU a uma pasta histórica
CREATE TABLE documento_digital (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo       VARCHAR(300) NOT NULL,
    formato      VARCHAR(6) NOT NULL CHECK (formato IN ('pdf', 'imagem')),
    descricao    TEXT,
    arquivo_id   UUID NOT NULL UNIQUE REFERENCES arquivo (id) ON DELETE RESTRICT,
    livro_id     UUID REFERENCES livro (id) ON DELETE CASCADE,
    pasta_id     UUID REFERENCES pasta_historica (id) ON DELETE CASCADE,
    data_upload  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_documento_vinculo CHECK ((livro_id IS NULL) <> (pasta_id IS NULL))
);
CREATE INDEX ix_documento_livro ON documento_digital (livro_id);
CREATE INDEX ix_documento_pasta ON documento_digital (pasta_id);

-- ------------------------------------------------------------
-- Mural digital (RF12)
-- ------------------------------------------------------------
CREATE TABLE publicacao (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo       VARCHAR(8) NOT NULL CHECK (tipo IN ('noticia', 'evento', 'novidade')),
    titulo     VARCHAR(200) NOT NULL,
    descricao  TEXT NOT NULL,
    data       DATE NOT NULL DEFAULT CURRENT_DATE,
    admin_id   UUID REFERENCES administrador (id)
);
CREATE INDEX ix_publicacao_data ON publicacao (data DESC);
CREATE INDEX ix_publicacao_tipo_data ON publicacao (tipo, data DESC); -- filtro por tipo do mural público

CREATE TABLE publicacao_imagem (
    publicacao_id  UUID NOT NULL REFERENCES publicacao (id) ON DELETE CASCADE,
    arquivo_id     UUID NOT NULL REFERENCES arquivo (id) ON DELETE RESTRICT,
    ordem          SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (publicacao_id, arquivo_id)
);

-- ============================================================
-- Regras que envolvem vários registros (triggers)
-- ============================================================

-- RN08: multa em aberto (pendente ou em análise) ou devolução atrasada
-- bloqueia novos empréstimos e reservas
CREATE FUNCTION fn_socio_bloqueado(p_socio UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (SELECT 1 FROM multa
                    WHERE socio_id = p_socio AND status IN ('pendente', 'em_analise'))
        OR EXISTS (SELECT 1 FROM emprestimo
                    WHERE socio_id = p_socio AND status = 'ativo'
                      AND data_prevista < CURRENT_DATE);
$$ LANGUAGE sql STABLE SET search_path = culturatech, public;

-- RN01: até 3 exemplares por sócio, somando empréstimos ativos e
-- reservas ativas (a reserva do próprio exemplar não conta em dobro)
CREATE FUNCTION fn_itens_do_socio(p_socio UUID, p_exemplar UUID) RETURNS INTEGER AS $$
    SELECT (SELECT count(*) FROM emprestimo
             WHERE socio_id = p_socio AND status = 'ativo')::INTEGER
         + (SELECT count(*) FROM reserva
             WHERE socio_id = p_socio AND status = 'ativa'
               AND exemplar_id <> p_exemplar)::INTEGER;
$$ LANGUAGE sql STABLE SET search_path = culturatech, public;

-- Valida um novo empréstimo: RN01, RN04, RN08 e disponibilidade do
-- exemplar (disponível, ou reservado para o próprio sócio)
CREATE FUNCTION fn_validar_emprestimo() RETURNS trigger AS $$
DECLARE
    v_categoria  VARCHAR(20);
    v_status     VARCHAR(15);
    v_baixa      DATE;
BEGIN
    -- empréstimos já encerrados (histórico migrado) não são validados
    IF NEW.status <> 'ativo' THEN
        RETURN NEW;
    END IF;

    SELECT l.categoria, e.status, e.baixa_data
      INTO v_categoria, v_status, v_baixa
      FROM exemplar e JOIN livro l ON l.id = e.livro_id
     WHERE e.id = NEW.exemplar_id
       FOR UPDATE OF e;

    IF v_baixa IS NOT NULL THEN
        RAISE EXCEPTION 'Exemplar não encontrado no acervo.';
    END IF;

    IF v_categoria IN ('raro', 'cordel', 'exemplar_unico') THEN
        RAISE EXCEPTION 'Esta obra é apenas para consulta local (RN04).';
    END IF;

    IF v_status = 'reservado' THEN
        IF NOT EXISTS (SELECT 1 FROM reserva r
                        WHERE r.exemplar_id = NEW.exemplar_id
                          AND r.socio_id = NEW.socio_id
                          AND r.status = 'ativa') THEN
            RAISE EXCEPTION 'Exemplar reservado para outro sócio-leitor.';
        END IF;
    ELSIF v_status <> 'disponivel' THEN
        RAISE EXCEPTION 'Exemplar indisponível para empréstimo.';
    END IF;

    -- trava o sócio para que dois empréstimos simultâneos não furem o limite
    PERFORM 1 FROM socio_leitor WHERE id = NEW.socio_id FOR UPDATE;

    IF fn_socio_bloqueado(NEW.socio_id) THEN
        RAISE EXCEPTION 'Sócio-leitor com pendências: novos empréstimos bloqueados (RN08).';
    END IF;

    IF fn_itens_do_socio(NEW.socio_id, NEW.exemplar_id) >= 3 THEN
        RAISE EXCEPTION 'Limite de 3 exemplares simultâneos atingido (RN01).';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = culturatech, public;

CREATE TRIGGER tg_validar_emprestimo
    BEFORE INSERT ON emprestimo
    FOR EACH ROW EXECUTE FUNCTION fn_validar_emprestimo();

-- Valida uma nova reserva (RF14 / RN28): exemplar emprestável e
-- disponível, sócio sem pendências e dentro do limite da RN01
CREATE FUNCTION fn_validar_reserva() RETURNS trigger AS $$
DECLARE
    v_categoria  VARCHAR(20);
    v_status     VARCHAR(15);
    v_baixa      DATE;
BEGIN
    IF NEW.status <> 'ativa' THEN
        RETURN NEW;
    END IF;

    SELECT l.categoria, e.status, e.baixa_data
      INTO v_categoria, v_status, v_baixa
      FROM exemplar e JOIN livro l ON l.id = e.livro_id
     WHERE e.id = NEW.exemplar_id
       FOR UPDATE OF e;

    IF v_baixa IS NOT NULL OR v_status <> 'disponivel' THEN
        RAISE EXCEPTION 'Exemplar indisponível para reserva.';
    END IF;

    IF v_categoria IN ('raro', 'cordel', 'exemplar_unico') THEN
        RAISE EXCEPTION 'Esta obra é apenas para consulta local (RN04).';
    END IF;

    PERFORM 1 FROM socio_leitor WHERE id = NEW.socio_id FOR UPDATE;

    IF fn_socio_bloqueado(NEW.socio_id) THEN
        RAISE EXCEPTION 'Sócio-leitor com pendências: novas reservas bloqueadas (RN08).';
    END IF;

    IF fn_itens_do_socio(NEW.socio_id, NEW.exemplar_id) >= 3 THEN
        RAISE EXCEPTION 'Limite de 3 exemplares simultâneos atingido (RN01).';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = culturatech, public;

CREATE TRIGGER tg_validar_reserva
    BEFORE INSERT ON reserva
    FOR EACH ROW EXECUTE FUNCTION fn_validar_reserva();

-- Mantém o status do exemplar coerente com a circulação, como o
-- protótipo faz: emprestado -> indisponivel; reservado -> reservado;
-- devolvido/cancelado/expirado -> disponivel (ou danificado)
CREATE FUNCTION fn_sincronizar_emprestimo() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'ativo' THEN
        UPDATE exemplar SET status = 'indisponivel' WHERE id = NEW.exemplar_id;
        UPDATE reserva SET status = 'retirada'
         WHERE exemplar_id = NEW.exemplar_id AND socio_id = NEW.socio_id AND status = 'ativa';
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'ativo' AND NEW.status <> 'ativo' THEN
        UPDATE exemplar
           SET status = CASE WHEN NEW.devolvido_danificado THEN 'danificado' ELSE 'disponivel' END
         WHERE id = NEW.exemplar_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = culturatech, public;

CREATE TRIGGER tg_sincronizar_emprestimo
    AFTER INSERT OR UPDATE OF status ON emprestimo
    FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_emprestimo();

CREATE FUNCTION fn_sincronizar_reserva() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'ativa' THEN
        UPDATE exemplar SET status = 'reservado' WHERE id = NEW.exemplar_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'ativa' AND NEW.status IN ('cancelada', 'expirada') THEN
        UPDATE exemplar SET status = 'disponivel'
         WHERE id = NEW.exemplar_id AND status = 'reservado';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = culturatech, public;

CREATE TRIGGER tg_sincronizar_reserva
    AFTER INSERT OR UPDATE OF status ON reserva
    FOR EACH ROW EXECUTE FUNCTION fn_sincronizar_reserva();

-- RN26: pessoa física pode receber no máximo 1 doação
CREATE FUNCTION fn_validar_doacao() RETURNS trigger AS $$
BEGIN
    IF NEW.tipo = 'doacao'
       AND (SELECT tipo FROM instituicao WHERE id = NEW.receptor_id) = 'pessoa_fisica'
       AND EXISTS (SELECT 1 FROM movimentacao
                    WHERE receptor_id = NEW.receptor_id AND tipo = 'doacao'
                      AND id <> NEW.id) THEN
        RAISE EXCEPTION 'Pessoa física já recebeu a doação permitida (RN26).';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = culturatech, public;

CREATE TRIGGER tg_validar_doacao
    BEFORE INSERT ON movimentacao
    FOR EACH ROW EXECUTE FUNCTION fn_validar_doacao();

-- ============================================================
-- Visões
-- ============================================================

-- Consulta pública (RN30): mascara status internos como "indisponivel"
-- e esconde exemplares baixados
CREATE VIEW vw_consulta_publica AS
SELECT l.id AS livro_id,
       l.titulo,
       l.editora,
       l.edicao,
       l.ano,
       l.categoria,
       l.secao,
       l.isbn,
       e.id AS exemplar_id,
       e.tombamento,
       CASE WHEN e.status IN ('em_restauro', 'extraviado', 'ocioso') THEN 'indisponivel'
            ELSE e.status END AS status
  FROM livro l
  JOIN exemplar e ON e.livro_id = l.id
 WHERE e.baixa_data IS NULL;

-- Situação do sócio-leitor (RN08): multas em aberto e devoluções atrasadas
-- bloqueiam novos empréstimos e reservas
CREATE VIEW vw_situacao_socio AS
SELECT s.id AS socio_id,
       s.nome,
       COALESCE(m.qtd, 0)   AS multas_abertas,
       COALESCE(m.total, 0) AS total_multas,
       COALESCE(a.qtd, 0)   AS emprestimos_atrasados,
       COALESCE(a.multa_corrente, 0) AS multa_corrente, -- RN03: R$ 1,00/dia
       (COALESCE(m.qtd, 0) + COALESCE(a.qtd, 0)) > 0 AS bloqueado
  FROM socio_leitor s
  LEFT JOIN (SELECT socio_id, count(*) AS qtd, sum(valor) AS total
               FROM multa WHERE status IN ('pendente', 'em_analise')
              GROUP BY socio_id) m ON m.socio_id = s.id
  LEFT JOIN (SELECT socio_id, count(*) AS qtd,
                    sum(CURRENT_DATE - data_prevista) * 1.00 AS multa_corrente
               FROM emprestimo
              WHERE status = 'ativo' AND data_prevista < CURRENT_DATE
              GROUP BY socio_id) a ON a.socio_id = s.id;
