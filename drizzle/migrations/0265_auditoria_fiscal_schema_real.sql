DO $do$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.auditoria_integridade()'::regprocedure);
 IF position('d.rejection_code' IN def)=0 OR position('d.environment' IN def)=0 THEN RAISE EXCEPTION 'Revisar auditoria fiscal antes de aplicar.'; END IF;
 def:=replace(def, 'coalesce('' · ''||d.rejection_code,'''')||', '');
 def:=replace(def, ' AND NOT coalesce(d.simulado,false)', '');
 def:=replace(def, 'SELECT d.kind||'' · ''||d.status||'' · ''||coalesce(d.number,'''') AS ref FROM fiscal_documents d WHERE d.environment=''producao''', 'SELECT e.operacao||'' · ''||e.status||'' · ''||e.ref AS ref FROM fiscal_focus_envios e WHERE e.ambiente=''producao''');
 EXECUTE def;
END $do$;