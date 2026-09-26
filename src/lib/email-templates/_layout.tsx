import * as React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Preview, Section, Text } from '@react-email/components'

export const SITE = 'https://www.lardan.com.br'
export const ARTE = `${SITE}/email/lardan-convite.jpg`

interface LayoutProps {
  preview: string
  selo: string
  titulo: string
  children: React.ReactNode
  botao?: { texto: string; link: string } | undefined
  rodape?: string | undefined
}

export const LardanLayout = ({ preview, selo, titulo, children, botao, rodape }: LayoutProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container style={outer}>
        <Text style={marca}>LARDAN</Text>
        <Text style={submarca}>JOIAS · SEMIJOIAS</Text>
        <Section style={card}>
          <Img src={ARTE} width="560" alt="Lardan" style={arte} />
          <Section style={inner}>
            <Text style={seloStyle}>{selo}</Text>
            <Heading style={h1}>{titulo}</Heading>
            <Hr style={fio} />
            {children}
            {botao ? (
              <Section style={{ textAlign: 'center', margin: '32px 0 8px' }}>
                <Button href={botao.link} style={button}>
                  {botao.texto}
                </Button>
              </Section>
            ) : null}
          </Section>
        </Section>
        <Text style={nota}>
          {rodape ?? 'Se você não esperava esta mensagem, pode ignorá-la com tranquilidade.'}
        </Text>
        <Text style={assinatura}>Com carinho, equipe Lardan · lardan.com.br</Text>
      </Container>
    </Body>
  </Html>
)

export const Paragrafo = ({ children }: { children: React.ReactNode }) => <Text style={text}>{children}</Text>

export const Codigo = ({ children }: { children: React.ReactNode }) => <Text style={codigo}>{children}</Text>

const serif = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const sans = "'Helvetica Neue', Arial, sans-serif"

const main = { backgroundColor: '#ffffff', fontFamily: sans, margin: 0, padding: 0 }
const outer = { maxWidth: '600px', margin: '0 auto', padding: '36px 20px 40px', backgroundColor: '#f8f2ec' }
const marca = { fontFamily: serif, fontSize: '30px', letterSpacing: '10px', color: '#3e2f2a', textAlign: 'center' as const, margin: '0' }
const submarca = { fontSize: '10px', letterSpacing: '4px', color: '#b57e6f', textAlign: 'center' as const, margin: '6px 0 28px' }
const card = { backgroundColor: '#fffdfa', borderRadius: '18px', overflow: 'hidden', border: '1px solid #ecdcd0' }
const arte = { display: 'block', width: '100%', height: 'auto', borderRadius: '18px 18px 0 0' }
const inner = { padding: '36px 40px 40px' }
const seloStyle = { fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase' as const, color: '#b57e6f', margin: '0 0 10px', textAlign: 'center' as const }
const h1 = { fontFamily: serif, fontSize: '32px', fontWeight: 500, lineHeight: '1.2', color: '#3e2f2a', margin: '0', textAlign: 'center' as const }
const fio = { borderColor: '#d9b9a8', width: '60px', margin: '22px auto 26px' }
const text = { fontSize: '15px', lineHeight: '1.75', color: '#5a4a44', margin: '0 0 16px', textAlign: 'center' as const }
const button = {
  backgroundColor: '#3e2f2a',
  color: '#fffdfa',
  fontSize: '13px',
  letterSpacing: '2px',
  textTransform: 'uppercase' as const,
  borderRadius: '999px',
  padding: '16px 36px',
  textDecoration: 'none',
}
const codigo = { fontFamily: 'Courier, monospace', fontSize: '30px', letterSpacing: '8px', color: '#3e2f2a', textAlign: 'center' as const, margin: '10px 0 20px', fontWeight: 700 }
const nota = { fontSize: '12px', lineHeight: '1.6', color: '#8a7a73', textAlign: 'center' as const, margin: '28px 16px 6px' }
const assinatura = { fontFamily: serif, fontSize: '14px', fontStyle: 'italic', color: '#b57e6f', textAlign: 'center' as const, margin: '0' }
