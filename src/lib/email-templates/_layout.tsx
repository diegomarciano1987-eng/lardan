import * as React from 'react'
import { Body, Button, Column, Container, Font, Head, Heading, Html, Img, Link, Preview, Row, Section, Text } from '@react-email/components'

export const SITE = 'https://www.lardan.com.br'
export const LOGO = `${SITE}/email/lardan-logo.png`

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
    <Head>
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
      <Font
        fontFamily="Cormorant Garamond"
        fallbackFontFamily="Georgia"
        webFont={{ url: 'https://fonts.gstatic.com/s/cormorantgaramond/v16/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYrEtFmSq17w.woff2', format: 'woff2' }}
        fontWeight={400}
        fontStyle="normal"
      />
      <Font
        fontFamily="Jost"
        fallbackFontFamily="Arial"
        webFont={{ url: 'https://fonts.gstatic.com/s/jost/v15/92zatBhPNqw73oTd4g.woff2', format: 'woff2' }}
        fontWeight={400}
        fontStyle="normal"
      />
    </Head>
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container style={outer}>
        {/* Faixa superior */}
        <Section style={topo}>
          <Text style={topoTexto}>JOIAS · SEMIJOIAS</Text>
        </Section>

        {/* Logo */}
        <Section style={logoBox}>
          <Link href={SITE}>
            <Img src={LOGO} width="240" height="52" alt="LARDAN" style={logoImg} />
          </Link>
        </Section>

        {/* Cartão principal com moldura dupla */}
        <Section style={moldura}>
          <Section style={card}>
            <Section style={inner}>
              <Row>
                <Column style={linhaCol}><div style={linha} /></Column>
                <Column style={seloCol}><Text style={seloStyle}>{selo}</Text></Column>
                <Column style={linhaCol}><div style={linha} /></Column>
              </Row>
              <Heading style={h1}>{titulo}</Heading>
              <Text style={diamante}>◆</Text>
              {children}
              {botao ? (
                <Section style={{ textAlign: 'center', margin: '34px 0 6px' }}>
                  <Button href={botao.link} style={button}>
                    {botao.texto}
                  </Button>
                  <Text style={linkAlt}>
                    Se o botão não abrir, copie este endereço no navegador:
                    <br />
                    <Link href={botao.link} style={linkAltA}>{botao.link}</Link>
                  </Text>
                </Section>
              ) : null}
            </Section>
          </Section>
        </Section>

        {/* Assinatura */}
        <Section style={{ padding: '34px 24px 0', textAlign: 'center' }}>
          <Text style={assinatura}>Com carinho,</Text>
          <Text style={assinaturaNome}>Família Lardan</Text>
          <Text style={nota}>
            {rodape ?? 'Se você não esperava esta mensagem, pode ignorá-la com tranquilidade.'}
          </Text>
          <Text style={rodapeLinks}>
            <Link href={SITE} style={rodapeLink}>lardan.com.br</Link>
          </Text>

          {/* Selos de segurança */}
          <Section style={selosBox}>
            <Text style={selosTitulo}>Segurança em primeiro lugar</Text>
            <Text style={selosLinha}>
              <span style={seloItem}>🔒 Dados 100% criptografados</span>
              <span style={seloItem}>🛡️ Compra segura</span>
              <span style={seloItem}>✔ Infraestrutura certificada SOC 2 · ISO 27001</span>
              <span style={seloItem}>📄 Privacidade LGPD</span>
            </Text>
          </Section>

          <Text style={legal}>Esta é uma mensagem automática. Por favor, não responda.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const Paragrafo = ({ children }: { children: React.ReactNode }) => <Text style={text}>{children}</Text>

export const Codigo = ({ children }: { children: React.ReactNode }) => (
  <Section style={codigoBox}>
    <Text style={codigo}>{children}</Text>
  </Section>
)

const serif = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const sans = "Jost, 'Helvetica Neue', Arial, sans-serif"

const tinta = '#4a3530'
const rose = '#b9806f'
const roseClaro = '#e6cfc3'
const creme = '#f7efe8'
const papel = '#fffdfa'

const main = { backgroundColor: '#ffffff', fontFamily: sans, margin: 0, padding: 0 }
const outer = { maxWidth: '620px', margin: '0 auto', backgroundColor: creme, padding: '0 0 44px' }
const topo = { backgroundColor: tinta, padding: '11px 20px' }
const topoTexto = { color: roseClaro, fontSize: '10px', letterSpacing: '3px', textAlign: 'center' as const, margin: 0, fontFamily: sans }
const logoBox = { padding: '38px 20px 30px', textAlign: 'center' as const }
const logoImg = { display: 'block', margin: '0 auto', border: 0, outline: 'none' }
const moldura = { margin: '0 auto', width: '580px', maxWidth: '100%', padding: '6px', border: `1px solid ${roseClaro}`, borderRadius: '4px', backgroundColor: papel }
const card = { backgroundColor: papel, border: `1px solid ${roseClaro}`, borderRadius: '2px', overflow: 'hidden' }
const inner = { padding: '40px 44px 44px' }
const linhaCol = { width: '32%', verticalAlign: 'middle' as const }
const linha = { borderTop: `1px solid ${roseClaro}`, height: '1px', lineHeight: '1px', fontSize: '1px' }
const seloCol = { width: '36%', verticalAlign: 'middle' as const }
const seloStyle = { fontSize: '10px', letterSpacing: '4px', textTransform: 'uppercase' as const, color: rose, margin: 0, textAlign: 'center' as const, fontFamily: sans }
const h1 = { fontFamily: serif, fontSize: '36px', fontWeight: 400, lineHeight: '1.15', color: tinta, margin: '22px 0 0', textAlign: 'center' as const }
const diamante = { color: rose, fontSize: '10px', textAlign: 'center' as const, margin: '18px 0 22px', letterSpacing: '2px' }
const text = { fontSize: '15px', lineHeight: '1.8', color: '#6a5750', margin: '0 0 14px', textAlign: 'center' as const, fontFamily: sans }
const button = {
  backgroundColor: tinta,
  color: papel,
  fontFamily: sans,
  fontSize: '12px',
  letterSpacing: '3px',
  textTransform: 'uppercase' as const,
  borderRadius: '2px',
  padding: '18px 42px',
  textDecoration: 'none',
  border: `1px solid ${tinta}`,
}
const linkAlt = { fontSize: '11px', lineHeight: '1.6', color: '#a0908a', margin: '22px 0 0', textAlign: 'center' as const, wordBreak: 'break-all' as const }
const linkAltA = { color: rose, textDecoration: 'underline' }
const codigoBox = { backgroundColor: creme, border: `1px dashed ${rose}`, borderRadius: '2px', margin: '14px 0 20px', padding: '8px 0' }
const codigo = { fontFamily: "'Courier New', Courier, monospace", fontSize: '32px', letterSpacing: '10px', color: tinta, textAlign: 'center' as const, margin: '8px 0', fontWeight: 700 }
const assinatura = { fontFamily: serif, fontSize: '17px', fontStyle: 'italic', color: rose, margin: 0 }
const assinaturaNome = { fontFamily: serif, fontSize: '22px', color: tinta, margin: '2px 0 24px', letterSpacing: '1px' }
const nota = { fontSize: '12px', lineHeight: '1.7', color: '#8a7a73', margin: '0 16px 14px', fontFamily: sans }
const rodapeLinks = { margin: '0 0 8px', fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase' as const }
const rodapeLink = { color: tinta, textDecoration: 'none' }
const legal = { fontSize: '10px', color: '#aa9a93', margin: 0, fontFamily: sans }
const selosBox = { margin: '18px 16px 16px', padding: '14px 10px 12px', borderTop: `1px solid ${roseClaro}` }
const selosTitulo = { fontSize: '9px', letterSpacing: '3px', textTransform: 'uppercase' as const, color: rose, margin: '0 0 10px', textAlign: 'center' as const, fontFamily: sans }
const selosLinha = { margin: 0, textAlign: 'center' as const, lineHeight: '2.1' }
const seloItem = { display: 'inline-block', fontSize: '10px', color: '#8a7a73', fontFamily: sans, border: `1px solid ${roseClaro}`, borderRadius: '20px', padding: '3px 12px', margin: '2px 4px', backgroundColor: papel }
