-- Demonstração para vídeos (Larissa Persinato): 40 peças fictícias em rascunho, maleta DEMO em operação, sem estoque nem financeiro.
DO $$
DECLARE eu uuid := 'f85f8e2d-1791-4f07-a75d-ae09bb37fd8d'; uid uuid := '27b777de-76bf-43ce-b566-af2df4ac8439';
  k uuid; cyc uuid; pid uuid; vid uuid; ma uuid; mb uuid; total bigint := 0; r record; n text;
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE 'demo-video' = ANY(tags)) THEN RETURN; END IF;
  UPDATE profiles SET full_name='Larissa Persinato', display_name='Larissa Persinato' WHERE id=uid;
  INSERT INTO kits (label, notes) VALUES ('Maleta DEMO vídeos','DEMONSTRAÇÃO — peças fictícias, sem estoque real') RETURNING id INTO k;
  INSERT INTO kit_cycles (kit_id,cycle_no,status,consultora_party_id,received_at,due_at,notes)
  VALUES (k,1,'operacao',eu,now(),now()+interval '30 days','DEMONSTRAÇÃO para vídeos — não movimenta estoque nem financeiro') RETURNING id INTO cyc;
  FOR r IN SELECT * FROM (VALUES
(1,'Brinco Argola Lisa Média','f1155552-82af-4756-afb3-738b89f593de','Dourado',5990),
(2,'Brinco Ponto de Luz Zircônia','f1155552-82af-4756-afb3-738b89f593de','Dourado',3990),
(3,'Brinco Gota Cristal Rosé','f1155552-82af-4756-afb3-738b89f593de','Rosé',6990),
(4,'Brinco Ear Cuff Cravejado','f1155552-82af-4756-afb3-738b89f593de','Dourado',5490),
(5,'Brinco Argola Trançada','f1155552-82af-4756-afb3-738b89f593de','Prata',6490),
(6,'Brinco Flor com Pérola','f1155552-82af-4756-afb3-738b89f593de','Dourado',4990),
(7,'Brinco Coração Vazado','f1155552-82af-4756-afb3-738b89f593de','Dourado',4490),
(8,'Brinco Franja de Bolinhas','f1155552-82af-4756-afb3-738b89f593de','Dourado',7990),
(9,'Brinco Trio Estrelas','f1155552-82af-4756-afb3-738b89f593de','Dourado',5990),
(10,'Brinco Argolinha Cravejada','f1155552-82af-4756-afb3-738b89f593de','Dourado',7490),
(11,'Colar Choker Riviera Zircônia','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',11990),
(12,'Colar Ponto de Luz Gota','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',7990),
(13,'Colar Elos Português','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',12990),
(14,'Colar Medalha Nossa Senhora','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',8990),
(15,'Colar Corrente Veneziana','5df8e077-4f87-4a17-827d-82c25e767b11','Prata',9990),
(16,'Colar Pérolas Delicado','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',10990),
(17,'Colar Coração Cravejado','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',8490),
(18,'Colar Gravatinha Zircônias','5df8e077-4f87-4a17-827d-82c25e767b11','Dourado',13990),
(19,'Pulseira Riviera Zircônia','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',14990),
(20,'Pulseira Elos Navegante','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',9990),
(21,'Pulseira Bolinhas Delicada','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',6990),
(22,'Pulseira Corações','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Prata',7990),
(23,'Pulseira Trevo Madrepérola','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',10990),
(24,'Pulseira Bracelete Liso','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',8990),
(25,'Pulseira Berloques Encanto','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',11990),
(26,'Pulseira Olho Grego','874f1b06-fbaa-46a1-bfc4-65ea7ffa9711','Dourado',6490),
(27,'Anel Solitário Zircônia','57507841-61f2-4933-9baa-2fd9b7022165','Dourado',6990),
(28,'Anel Aparador Cravejado','57507841-61f2-4933-9baa-2fd9b7022165','Dourado',5490),
(29,'Anel Meia Aliança','57507841-61f2-4933-9baa-2fd9b7022165','Prata',6490),
(30,'Anel Gota Rosé','57507841-61f2-4933-9baa-2fd9b7022165','Rosé',7490),
(31,'Anel Trio Empilhável','57507841-61f2-4933-9baa-2fd9b7022165','Dourado',3990),
(32,'Anel Coração Delicado','57507841-61f2-4933-9baa-2fd9b7022165','Dourado',4990),
(33,'Tornozeleira Bolinhas','93959dbd-edaf-4ae5-ae9e-b93ce6c9924e','Dourado',5990),
(34,'Tornozeleira Estrelas','93959dbd-edaf-4ae5-ae9e-b93ce6c9924e','Prata',5490),
(35,'Tornozeleira Corações','93959dbd-edaf-4ae5-ae9e-b93ce6c9924e','Dourado',6490),
(36,'Conjunto Ponto de Luz','af3b1102-65b9-4307-a6ff-068de6329bbe','Dourado',10990),
(37,'Conjunto Gota Rosé','af3b1102-65b9-4307-a6ff-068de6329bbe','Rosé',13990),
(38,'Conjunto Pérolas Clássico','af3b1102-65b9-4307-a6ff-068de6329bbe','Dourado',12990),
(39,'Pingente Letra Cravejada','6a4d46f3-5365-4cd3-b05c-8fb809bc7291','Dourado',4490),
(40,'Pingente Coração Cadeado','6a4d46f3-5365-4cd3-b05c-8fb809bc7291','Dourado',4990)
  ) t(i,nome,cat,banho,preco) LOOP
    n := lpad(r.i::text,2,'0');
    INSERT INTO products (slug,name,category_id,plating,price_cents,status,tags,internal_code,short_description)
    VALUES ('demo-'||n,r.nome,r.cat::uuid,r.banho,r.preco,'rascunho',ARRAY['demo-video'],'DEMO-'||n,'Peça fictícia de demonstração') RETURNING id INTO pid;
    UPDATE product_variants SET price_cents=r.preco, label=r.banho, sku='DEMO-'||n WHERE product_id=pid RETURNING id INTO vid;
    INSERT INTO media_assets (storage_path,url,alt,width,height,content_type) VALUES ('demo-video/'||n||'a.jpg','demo-video/'||n||'a.jpg',r.nome,816,816,'image/jpeg') RETURNING id INTO ma;
    INSERT INTO media_assets (storage_path,url,alt,width,height,content_type) VALUES ('demo-video/'||n||'b.jpg','demo-video/'||n||'b.jpg',r.nome||' — no corpo',816,816,'image/jpeg') RETURNING id INTO mb;
    INSERT INTO product_media (product_id,media_id,position) VALUES (pid,ma,0),(pid,mb,1);
    INSERT INTO kit_balances (cycle_id,variant_id,qty_allocated,qty_accepted) VALUES (cyc,vid,1,1);
    total := total + r.preco;
  END LOOP;
  UPDATE kit_cycles SET quantity_total=40, reference_total_cents=total WHERE id=cyc;
  INSERT INTO audit_logs (action,entity,entity_id,payload) VALUES ('demo.maleta_criada','kit_cycles',cyc::text,jsonb_build_object('pecas',40,'total_cents',total,'motivo','gravação de vídeos'));
END $$;