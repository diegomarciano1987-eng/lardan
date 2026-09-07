
-- 1) Categorias canônicas -----------------------------------------------
UPDATE public.categories SET
  name = 'Brincos',
  slug = 'brincos',
  description = 'Brincos Lardan em banho de ouro: peças leves, confortáveis e feitas para o uso diário, do trabalho ao jantar.',
  seo_title = 'Brincos de semijoia | LARDAN',
  seo_description = 'Brincos de semijoia Lardan em banho de ouro 18k: argolas, pérolas, cristais e gotas para acompanhar todos os seus momentos.',
  position = 1,
  updated_at = now()
WHERE id = 'f1155552-82af-4756-afb3-738b89f593de';

INSERT INTO public.categories (slug, name, description, seo_title, seo_description, position, status)
SELECT 'colares', 'Colares',
  'Colares Lardan em banho de ouro: correntes delicadas, pingentes e peças de presença para compor com leveza.',
  'Colares de semijoia | LARDAN',
  'Colares de semijoia Lardan em banho de ouro 18k: correntes finas, pingentes de cristal e elos marcantes.',
  2, 'rascunho'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'colares');

-- 2) Peças reais ---------------------------------------------------------
DO $$
DECLARE
  _cat_br uuid; _cat_cl uuid; _pid uuid; _r record;
BEGIN
  SELECT id INTO _cat_br FROM public.categories WHERE slug = 'brincos';
  SELECT id INTO _cat_cl FROM public.categories WHERE slug = 'colares';

  FOR _r IN
    SELECT * FROM (VALUES
      ('brinco-lume-dourado','Brinco Lume Dourado','BR-LUME-001','brincos',12990,
       'Argola pequena com gota lisa em banho de ouro.',
       'O Brinco Lume Dourado une uma argola pequena de acabamento espelhado a uma gota lisa que balança com discrição. Leve no uso diário e elegante à noite, é a peça de entrada perfeita para quem gosta de brilho sem excesso.',
       'Latão','Banho de ouro 18k','Argola 12 mm · gota 14 mm · peso 2,4 g',
       '7d4921d5-b06a-4e21-8abb-72bb2ebd4abe','8a284919-2c3e-4a23-b433-f4ea58798df6'),
      ('brinco-aurora-perola','Brinco Aurora Pérola','BR-AURORA-002','brincos',14990,
       'Ponto de luz com pérola redonda em base dourada.',
       'O Brinco Aurora Pérola traz uma pérola redonda de brilho suave sobre base dourada. Clássico e atemporal, acompanha do escritório ao casamento sem nunca pesar na orelha.',
       'Latão','Banho de ouro 18k','Pérola 8 mm · peso 1,8 g',
       '68d02a5a-f387-4091-8d80-fa74d73ffed9','5984f6e2-d22c-4084-b637-b95adeebf27f'),
      ('brinco-iris-cristal','Brinco Íris Cristal','BR-IRIS-003','brincos',15990,
       'Trio de cristais facetados em navete dourada.',
       'O Brinco Íris Cristal reúne cristais facetados em formato navete, montados um a um em garras douradas. A luz entra por vários ângulos e devolve um brilho vivo, mesmo em peça pequena.',
       'Latão','Banho de ouro 18k','Altura 11 mm · largura 10 mm · peso 1,6 g',
       'd565faa0-085f-49d1-b796-4994ec69de83','15897759-1ad0-4524-8c64-21b0c2c1268f'),
      ('brinco-serena-argola','Brinco Serena Argola','BR-SERENA-004','brincos',13990,
       'Argola média lisa, tubular e confortável.',
       'O Brinco Serena Argola tem tubo liso de acabamento polido e fecho de encaixe firme. É a argola de todo dia: fica bem com cabelo preso, solto, camiseta ou alfaiataria.',
       'Latão','Banho de ouro 18k','Diâmetro 28 mm · tubo 3 mm · peso 3,2 g',
       '86102bc9-2d24-4d6a-afb0-f82e91d27425','164614da-7fbf-4720-864c-d3608e7c9179'),
      ('brinco-celeste-gota','Brinco Celeste Gota','BR-CELESTE-005','brincos',16990,
       'Gota alongada pendente com balanço suave.',
       'O Brinco Celeste Gota tem uma gota alongada de superfície espelhada, suspensa por fio francês. O movimento é suave e alonga o rosto — a escolha certa para uma noite especial.',
       'Latão','Banho de ouro 18k','Comprimento total 42 mm · peso 3,8 g',
       '6edccb20-471b-4595-abeb-666453c3c986','eff953b5-b193-4cd1-bb45-d02965f02c2a'),
      ('colar-essenza','Colar Essenza','CL-ESSENZA-001','colares',18990,
       'Corrente fina com pingente oval liso.',
       'O Colar Essenza combina corrente fina e um pingente oval de superfície lisa. Discreto o bastante para usar sozinho e perfeito para compor camadas com outros colares da marca.',
       'Latão','Banho de ouro 18k','Corrente 45 cm com extensor de 5 cm · pingente 14 mm',
       '1a311ca2-0c7c-4c54-98a0-91b3e013ff03','6223db38-7b00-4d2b-a24d-07b44396f3ac'),
      ('colar-lumiere','Colar Lumière','CL-LUMIERE-002','colares',21990,
       'Pingente redondo de cristal em aro dourado.',
       'O Colar Lumière tem cristal redondo facetado montado em aro dourado. O corte devolve luz a cada movimento e dá acabamento a decotes em V.',
       'Latão','Banho de ouro 18k','Corrente 42 cm com extensor de 5 cm · pingente 12 mm',
       'e2c15e33-79f4-4600-bd4b-f26615fdca0b','5c63da4e-1474-4bf5-b70f-ec84f1a9c6c9'),
      ('colar-riviera-cristal','Colar Riviera Cristal','CL-RIVIERA-003','colares',24990,
       'Fileira contínua de cristais facetados.',
       'O Colar Riviera Cristal alinha cristais facetados lado a lado em trilho dourado. É a peça de festa da coleção: brilha sozinha e dispensa qualquer outro adorno.',
       'Latão','Banho de ouro 18k','Comprimento 40 cm com extensor de 6 cm',
       '52d2d133-0f53-4066-aba7-09a295674cb5','1e30af39-e085-483c-bb91-55440e8b1686'),
      ('colar-elo-dourado','Colar Elo Dourado','CL-ELO-004','colares',19990,
       'Elos grossos polidos, de presença marcante.',
       'O Colar Elo Dourado traz elos largos e polidos, com fecho reforçado. Peça de presença para dar personalidade a looks simples.',
       'Latão','Banho de ouro 18k','Comprimento 45 cm · elo 14 mm · peso 28 g',
       '75792cef-0e2f-465b-b502-9d934e895ea8','0e910cee-6163-488b-a5e0-21baed3f0776'),
      ('colar-ponto-de-luz','Colar Ponto de Luz','CL-LUZ-005','colares',17990,
       'Solitário de cristal em corrente ultrafina.',
       'O Colar Ponto de Luz tem um único cristal solitário em corrente ultrafina, quase invisível na pele. É o colar de uso contínuo: entra no banho, na academia e no dia a dia.',
       'Latão','Banho de ouro 18k','Corrente 40 cm com extensor de 5 cm · cristal 4 mm',
       '691aef40-d0c5-4a4e-a0b1-3d43dea100d2','329bf922-2cda-450d-ac8c-835b054fcae6')
    ) AS t(slug, nome, sku, cat, preco, curta, longa, material, banho, medidas, midia1, midia2)
  LOOP
    SELECT id INTO _pid FROM public.products WHERE slug = _r.slug;

    IF _pid IS NULL THEN
      INSERT INTO public.products (
        slug, name, category_id, short_description, description, material, plating,
        measurements, care_instructions, warranty_text, price_cents, price_is_public,
        position, status, is_featured, is_new_arrival, tags
      ) VALUES (
        _r.slug, _r.nome,
        CASE WHEN _r.cat = 'brincos' THEN _cat_br ELSE _cat_cl END,
        _r.curta, _r.longa, _r.material, _r.banho, _r.medidas,
        'Guarde em local seco, longe de perfume e produtos de limpeza. Limpe com flanela macia após o uso.',
        'Garantia de 6 meses contra defeitos de fabricação e do banho, mediante uso indicado.',
        _r.preco, true, 1, 'rascunho', true, true, ARRAY['demonstracao']::text[]
      ) RETURNING id INTO _pid;
    ELSE
      UPDATE public.products SET
        name = _r.nome, category_id = CASE WHEN _r.cat = 'brincos' THEN _cat_br ELSE _cat_cl END,
        short_description = _r.curta, description = _r.longa, material = _r.material,
        plating = _r.banho, measurements = _r.medidas, price_cents = _r.preco,
        price_is_public = true, updated_at = now()
      WHERE id = _pid;
    END IF;

    -- variação canônica com código próprio
    UPDATE public.product_variants
       SET label = 'Único', sku = _r.sku, legacy_code = _r.sku,
           price_cents = _r.preco, is_active = true, updated_at = now()
     WHERE product_id = _pid AND is_default;

    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = _pid) THEN
      INSERT INTO public.product_variants (product_id, label, sku, legacy_code, price_cents, is_default, is_active, position)
      VALUES (_pid, 'Único', _r.sku, _r.sku, _r.preco, true, true, 0);
    END IF;

    -- duas fotos por peça
    INSERT INTO public.product_media (product_id, media_id, position)
    SELECT _pid, _r.midia1::uuid, 0
     WHERE NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = _pid AND media_id = _r.midia1::uuid);
    INSERT INTO public.product_media (product_id, media_id, position)
    SELECT _pid, _r.midia2::uuid, 1
     WHERE NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = _pid AND media_id = _r.midia2::uuid);
  END LOOP;
END $$;
