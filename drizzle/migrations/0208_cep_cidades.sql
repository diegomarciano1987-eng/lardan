CREATE TABLE IF NOT EXISTS public.cep_cidades (
  cep text PRIMARY KEY CHECK (cep ~ '^\d{8}$'),
  cidade text NOT NULL,
  uf char(2) NOT NULL,
  fonte text NOT NULL DEFAULT 'brasilapi-cep-v1',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cep_cidades TO service_role;
ALTER TABLE public.cep_cidades ENABLE ROW LEVEL SECURITY;

-- Endereço sem cidade: completa pelo CEP conhecido (mesma UF).
CREATE OR REPLACE FUNCTION public.endereco_cidade_pelo_cep_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  IF nullif(btrim(coalesce(new.city,'')),'') IS NULL THEN
    SELECT cidade, uf INTO c FROM cep_cidades WHERE cep = regexp_replace(coalesce(new.postal_code,''),'\D','','g');
    IF found AND (new.uf IS NULL OR upper(new.uf) = c.uf) THEN
      new.city := c.cidade; new.uf := c.uf;
    END IF;
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.endereco_cidade_pelo_cep_trg() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS a_endereco_cidade_pelo_cep ON public.party_addresses;
CREATE TRIGGER a_endereco_cidade_pelo_cep BEFORE INSERT OR UPDATE OF postal_code, city ON public.party_addresses
FOR EACH ROW EXECUTE FUNCTION public.endereco_cidade_pelo_cep_trg();

-- Quando um CEP novo é aprendido, completa endereços que estavam sem cidade (dispara a praça).
CREATE OR REPLACE FUNCTION public.cep_cidade_aplicar_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE party_addresses SET city = new.cidade, uf = new.uf
   WHERE (city IS NULL OR btrim(city) = '')
     AND regexp_replace(coalesce(postal_code,''),'\D','','g') = new.cep
     AND (uf IS NULL OR upper(uf) = new.uf);
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.cep_cidade_aplicar_trg() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS cep_cidade_aplicar ON public.cep_cidades;
CREATE TRIGGER cep_cidade_aplicar AFTER INSERT OR UPDATE ON public.cep_cidades
FOR EACH ROW EXECUTE FUNCTION public.cep_cidade_aplicar_trg();

INSERT INTO public.cep_cidades (cep, cidade, uf) VALUES
('19260000','Mirante do Paranapanema','SP'),
('19280000','Teodoro Sampaio','SP'),
('84285000','Figueira','PR'),
('84930000','Jaboti','PR'),
('84950000','Wenceslau Braz','PR'),
('86135000','Bela Vista do Paraíso','PR'),
('86206620','Ibiporã','PR'),
('86455000','Joaquim Távora','PR'),
('86465000','Guapirama','PR'),
('86705772','Arapongas','PR')
ON CONFLICT (cep) DO NOTHING;