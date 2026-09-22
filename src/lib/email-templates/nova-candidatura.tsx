import React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  protocolo?: string
  nome?: string
  cidade?: string
  uf?: string
  whatsapp?: string
  email?: string | null
  origem?: string
  reenvio?: boolean
  quando?: string
}

const linkWhatsapp = (numero?: string) => {
  const digitos = (numero ?? '').replace(/\D/g, '')
  if (!digitos) return null
  return `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}`
}

const Email = ({
  protocolo,
  nome,
  cidade,
  uf,
  whatsapp,
  email,
  origem,
  reenvio,
  quando,
}: Props) => {
  const titulo = reenvio ? 'Candidatura reenviada' : 'Nova candidatura'
  const wa = linkWhatsapp(whatsapp)
  const local = [cidade, uf].filter(Boolean).join('/')

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{`${titulo}: ${nome ?? 'candidata'}${local ? ` — ${local}` : ''}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={topo}>
            <Text style={marca}>LARDAN</Text>
            <Text style={sobrancelha}>{titulo}</Text>
          </Section>

          <Heading style={nomeStyle}>{nome ?? 'Candidata sem nome informado'}</Heading>
          {local ? <Text style={localStyle}>{local}</Text> : null}

          <Section style={cartao}>
            <Linha rotulo="Protocolo" valor={protocolo} />
            <Linha rotulo="WhatsApp" valor={whatsapp} />
            <Linha rotulo="E-mail" valor={email ?? '—'} />
            <Linha rotulo="Origem" valor={origem ?? 'Não identificada'} />
            <Linha rotulo="Recebida em" valor={quando} />
          </Section>

          {wa ? (
            <Section style={{ textAlign: 'center', padding: '4px 0 8px' }}>
              <Link href={wa} style={botao}>
                Falar no WhatsApp
              </Link>
            </Section>
          ) : null}

          <Section style={{ textAlign: 'center', padding: '4px 0 16px' }}>
            <Link href="https://www.lardan.com.br/admin/candidaturas" style={botaoSecundario}>
              Abrir no painel
            </Link>
          </Section>

          <Hr style={risco} />
          <Text style={rodape}>
            Aviso automático do painel Lardan · Candidaturas do Site. Os dados acima foram
            informados pela própria candidata no formulário Seja Lardan.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) => (
  <Text style={linha}>
    <span style={rotuloStyle}>{rotulo}</span>
    <span style={valorStyle}>{valor && valor !== '' ? valor : '—'}</span>
  </Text>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `${data['reenvio'] ? 'Candidatura reenviada' : 'Nova candidatura'}: ${
      data['nome'] ?? 'candidata'
    }${data['cidade'] ? ` — ${data['cidade']}/${data['uf'] ?? ''}` : ''}`,
  displayName: 'Nova candidatura (aviso interno)',
  to: 'lardansemijoias@gmail.com',
  previewData: {
    protocolo: 'LRD-2026-000123',
    nome: 'Maria Aparecida Souza',
    cidade: 'Cascavel',
    uf: 'PR',
    whatsapp: '(45) 99999-0000',
    email: 'maria@exemplo.com',
    origem: 'Google orgânico',
    reenvio: false,
    quando: '22/09/2026 10:42',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: "'Jost', Helvetica, Arial, sans-serif",
  color: '#171512',
  margin: 0,
}
const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '32px 28px 28px',
  backgroundColor: '#fbfaf7',
  border: '1px solid #cfc5b7',
  borderRadius: '14px',
}
const topo = { paddingBottom: '8px' }
const marca = {
  margin: 0,
  fontSize: '13px',
  letterSpacing: '0.38em',
  fontWeight: 700,
  color: '#7c5540',
}
const sobrancelha = {
  margin: '10px 0 0',
  fontSize: '12px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  color: '#57514a',
  fontWeight: 600,
}
const nomeStyle = {
  margin: '14px 0 2px',
  fontSize: '26px',
  lineHeight: '1.2',
  fontWeight: 700,
  color: '#171512',
}
const localStyle = { margin: '0 0 18px', fontSize: '15px', color: '#57514a', fontWeight: 500 }
const cartao = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2dacd',
  borderRadius: '10px',
  padding: '16px 18px',
  margin: '0 0 20px',
}
const linha = { margin: '0 0 10px', fontSize: '15px', lineHeight: '1.5' }
const rotuloStyle = {
  display: 'block',
  fontSize: '11px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: '#7c5540',
  fontWeight: 600,
}
const valorStyle = { display: 'block', color: '#171512', fontWeight: 500 }
const botao = {
  display: 'inline-block',
  backgroundColor: '#7c5540',
  color: '#fbfaf7',
  padding: '13px 26px',
  borderRadius: '999px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
}
const botaoSecundario = {
  display: 'inline-block',
  border: '1px solid #7c5540',
  color: '#7c5540',
  padding: '11px 24px',
  borderRadius: '999px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
}
const risco = { borderColor: '#e2dacd', margin: '8px 0 14px' }
const rodape = { margin: 0, fontSize: '12px', lineHeight: '1.6', color: '#57514a' }
