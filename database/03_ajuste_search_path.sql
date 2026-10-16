-- ============================================================
-- CulturaTech - Ajuste para bancos já criados
-- As funções passaram a fixar o próprio search_path (veja
-- 01_schema.sql). Quem criou o banco antes dessa mudança roda este
-- arquivo uma vez; num banco novo ele não é necessário (mas é inofensivo).
-- ============================================================

SET client_encoding TO 'UTF8';

ALTER FUNCTION culturatech.fn_socio_bloqueado(UUID)        SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_itens_do_socio(UUID, UUID)   SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_validar_emprestimo()         SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_validar_reserva()            SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_sincronizar_emprestimo()     SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_sincronizar_reserva()        SET search_path = culturatech, public;
ALTER FUNCTION culturatech.fn_validar_doacao()             SET search_path = culturatech, public;
