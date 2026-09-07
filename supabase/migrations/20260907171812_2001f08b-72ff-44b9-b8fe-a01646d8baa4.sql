-- Categorias canônicas Anéis e Pulseiras (sem duplicar)
INSERT INTO public.categories (slug, name, description, seo_title, seo_description, position, status, hero_media_id)
SELECT 'aneis', 'Anéis',
  'Anéis Lardan em banho de ouro: aros delicados, solitários e desenhos contemporâneos para usar sozinhos ou em camadas.',
  'Anéis de semijoia | LARDAN',
  'Anéis de semijoia Lardan em banho de ouro 18k: solitários, meia aliança, aros lisos e desenhos orgânicos com cristais.',
  3, 'rascunho', '7c573c80-6209-4671-b7b9-f70e99934333'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'aneis');

INSERT INTO public.categories (slug, name, description, seo_title, seo_description, position, status, hero_media_id)
SELECT 'pulseiras', 'Pulseiras',
  'Pulseiras e braceletes Lardan em banho de ouro: correntes leves, riviera de cristais e braceletes rígidos de linhas limpas.',
  'Pulseiras de semijoia | LARDAN',
  'Pulseiras e braceletes de semijoia Lardan em banho de ouro 18k: correntes finas, pontos de luz, riviera e braceletes rígidos.',
  4, 'rascunho', '817eb997-65ad-4336-a4c9-4ee520fee163'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = 'pulseiras');

DO $$
DECLARE
  _cat_an uuid; _cat_pl uuid; _pid uuid; _r record; _tam text; _i int; _tams text[];
BEGIN
  SELECT id INTO _cat_an FROM public.categories WHERE slug = 'aneis';
  SELECT id INTO _cat_pl FROM public.categories WHERE slug = 'pulseiras';

  FOR _r IN
    SELECT * FROM (VALUES
      ('anel-solenne','Anel Solenne','AN-SOLENNE-001','aneis',15990,'7890001000015',
       'Aro fino dourado com zircônia central.',
       'O Anel Solenne tem aro fino de acabamento polido e uma zircônia central de corte brilhante. Discreto e confortável, é o anel de todo dia que também combina com ocasiões especiais.',
       'Latão','Banho de ouro 18k','Aro 1,6 mm · zircônia 4 mm · peso 1,9 g', ARRAY['14','16','18'],
       '7c573c80-6209-4671-b7b9-f70e99934333','b2b47b48-38b9-49f1-b47c-c7c0baf5e2cb'),
      ('anel-eclat','Anel Éclat','AN-ECLAT-002','aneis',18990,'7890001000022',
       'Desenho orgânico dourado com pequenos cristais.',
       'O Anel Éclat tem linhas onduladas que acompanham o dedo, com pequenos cristais cravejados ao longo das curvas. Um desenho contemporâneo que brilha sem exagero.',
       'Latão','Banho de ouro 18k','Largura 3 mm · peso 2,4 g', ARRAY['14','16','18'],
       '5d788c76-83ad-4d6c-8914-f0b0e6dfd2e6','b98d0e2e-b131-41e1-bd63-16bcadc22580'),
      ('anel-lumiere','Anel Lumière','AN-LUMIERE-003','aneis',17990,'7890001000039',
       'Solitário elegante com pedra clara.',
       'O Anel Lumière traz uma pedra clara facetada em garras douradas, elevada sobre o aro. É a peça de presença serena, perfeita para presentear.',
       'Latão','Banho de ouro 18k','Pedra 8 mm · aro 2 mm · peso 2,8 g', ARRAY['14','16','18'],
       'f71e1c65-4733-4015-98f4-3e0f606cb316','2e9437f7-a450-4344-96f8-da9c42b88728'),
      ('anel-riviera','Anel Riviera','AN-RIVIERA-004','aneis',21990,'7890001000046',
       'Meia aliança com sequência refinada de cristais.',
       'O Anel Riviera alinha cristais lado a lado na frente do aro, em cravação delicada. Usado sozinho ou junto a uma aliança lisa, dá acabamento à mão.',
       'Latão','Banho de ouro 18k','Largura 2,5 mm · peso 2,6 g', ARRAY['14','16','18'],
       '45349cc4-51a4-4724-a673-b6d9ed1fbea7','785651ea-51f7-4ea3-bf7c-5bc85facf66d'),
      ('anel-aura-dourada','Anel Aura Dourada','AN-AURA-005','aneis',16990,'7890001000053',
       'Aro contemporâneo com curvas suaves.',
       'O Anel Aura Dourada tem volume arredondado e superfície espelhada, sem pedras. Uma peça escultural e leve, de leitura moderna.',
       'Latão','Banho de ouro 18k','Largura 8 mm · peso 4,2 g', ARRAY['14','16','18'],
       '7e672658-50b4-4bef-8363-760020ec1d6d','2dae6553-f005-43d0-83d2-b4b9a9959f89'),
      ('pulseira-serena','Pulseira Serena','PL-SERENA-001','pulseiras',14990,'7890002000014',
       'Corrente dourada fina e delicada.',
       'A Pulseira Serena tem corrente fina de elos miúdos e fecho lagosta firme. Leve no pulso, é ideal para usar sozinha ou em camadas com outras pulseiras.',
       'Latão','Banho de ouro 18k','Comprimento com extensor de 3 cm · corrente 1,2 mm', ARRAY['16 cm','18 cm','20 cm'],
       'd805ee22-c77e-4620-bf35-3a04672f72f4','465fce45-16a0-465e-9338-fbda194e49a4'),
      ('pulseira-lumi','Pulseira Lumi','PL-LUMI-002','pulseiras',16990,'7890002000021',
       'Corrente delicada com pontos de luz.',
       'A Pulseira Lumi distribui pequenos cristais ao longo da corrente fina, criando pontos de brilho a cada movimento do pulso.',
       'Latão','Banho de ouro 18k','Corrente 1,2 mm · cristais 2,5 mm', ARRAY['16 cm','18 cm','20 cm'],
       'dc156797-fe52-4bb7-b4b7-30d99e059e1d','b8ba1ef4-1d4d-4b62-8fbc-4f974f447807'),
      ('pulseira-riviera','Pulseira Riviera','PL-RIVIERA-003','pulseiras',22990,'7890002000038',
       'Sequência elegante de cristais.',
       'A Pulseira Riviera alinha cristais facetados de ponta a ponta, em trilho dourado com fecho de segurança. É a peça de festa da linha.',
       'Latão','Banho de ouro 18k','Largura 4 mm · fecho com trava dupla', ARRAY['16 cm','18 cm','20 cm'],
       '817eb997-65ad-4336-a4c9-4ee520fee163','49339ada-b20b-491f-9690-61d7dfd6c06e'),
      ('bracelete-essenza','Bracelete Essenza','PL-ESSENZA-004','pulseiras',19990,'7890002000045',
       'Bracelete rígido, minimalista e contemporâneo.',
       'O Bracelete Essenza é rígido, de superfície lisa e abertura discreta que facilita o encaixe. Uma peça de linhas limpas para looks de alfaiataria.',
       'Latão','Banho de ouro 18k','Largura 10 mm · abertura ajustável · peso 18 g', ARRAY['Ajustável'],
       '5c593d0c-b2de-472a-b857-0bd19ea40f19','59413f08-eb31-4b2b-bea8-b0ae1eabc848'),
      ('pulseira-elo-dourado','Pulseira Elo Dourado','PL-ELO-005','pulseiras',18990,'7890002000052',
       'Elos dourados refinados e leves.',
       'A Pulseira Elo Dourado traz elos ovais achatados e polidos, leves no pulso e com fecho reforçado. Presença sem peso.',
       'Latão','Banho de ouro 18k','Elo 8 mm · fecho lagosta', ARRAY['16 cm','18 cm','20 cm'],
       'c06683dc-33ac-4ea5-bf4e-306e026a1f3b','d7caaab9-e438-4893-9189-dadeed9b26b7')
    ) AS t(slug, nome, codigo, cat, preco, ean, curta, longa, material, banho, medidas, tamanhos, midia1, midia2)
  LOOP
    SELECT id INTO _pid FROM public.products WHERE slug = _r.slug;

    IF _pid IS NULL THEN
      INSERT INTO public.products (
        slug, name, category_id, short_description, description, material, plating,
        measurements, care_instructions, warranty_text, price_cents, price_is_public,
        position, status, is_featured, is_new_arrival, tags, legacy_code
      ) VALUES (
        _r.slug, _r.nome,
        CASE WHEN _r.cat = 'aneis' THEN _cat_an ELSE _cat_pl END,
        _r.curta, _r.longa, _r.material, _r.banho, _r.medidas,
        'Guarde em local seco, longe de perfume e produtos de limpeza. Limpe com flanela macia após o uso.',
        'Garantia de 6 meses contra defeitos de fabricação e do banho, mediante uso indicado.',
        _r.preco, true, 1, 'rascunho', true, true, ARRAY['demonstracao']::text[], _r.codigo
      ) RETURNING id INTO _pid;
    ELSE
      UPDATE public.products SET
        name = _r.nome, category_id = CASE WHEN _r.cat = 'aneis' THEN _cat_an ELSE _cat_pl END,
        short_description = _r.curta, description = _r.longa, material = _r.material,
        plating = _r.banho, measurements = _r.medidas, price_cents = _r.preco,
        price_is_public = true, legacy_code = _r.codigo, updated_at = now()
      WHERE id = _pid;
    END IF;

    _tams := _r.tamanhos;
    _i := 0;
    FOREACH _tam IN ARRAY _tams LOOP
      IF _i = 0 THEN
        UPDATE public.product_variants
           SET label = _tam, size = _tam, sku = _r.codigo || '-' || replace(_tam, ' ', ''),
               legacy_code = _r.codigo || '-' || replace(_tam, ' ', ''),
               barcode = _r.ean, price_cents = _r.preco, is_active = true, position = 0, updated_at = now()
         WHERE product_id = _pid AND is_default;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = _pid AND label = _tam) THEN
        INSERT INTO public.product_variants (product_id, label, size, sku, legacy_code, barcode, price_cents, is_default, is_active, position)
        VALUES (_pid, _tam, _tam, _r.codigo || '-' || replace(_tam, ' ', ''), _r.codigo || '-' || replace(_tam, ' ', ''), '2' || substr(_r.ean, 2, 11) || _i::text, _r.preco, false, true, _i);
      END IF;
      _i := _i + 1;
    END LOOP;

    INSERT INTO public.product_media (product_id, media_id, position)
    SELECT _pid, _r.midia1::uuid, 0
     WHERE NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = _pid AND media_id = _r.midia1::uuid);
    INSERT INTO public.product_media (product_id, media_id, position)
    SELECT _pid, _r.midia2::uuid, 1
     WHERE NOT EXISTS (SELECT 1 FROM public.product_media WHERE product_id = _pid AND media_id = _r.midia2::uuid);
  END LOOP;
END $$;