import React from 'react'
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  nome?: string
  link?: string
  expira?: string
}

const Email = ({ nome, link, expira }: Props) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu convite de acesso à Lardan</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Seu acesso à Lardan</Heading>
        <Text style={text}>{nome ? `Olá, ${nome}!` : 'Olá!'}</Text>
        <Text style={text}>
          Você recebeu um convite para acessar o sistema da Lardan. Toque no botão abaixo para criar sua senha
          ou entrar com a conta deste e-mail.
        </Text>
        {link ? (
          <Button href={link} style={button}>
            Aceitar convite
          </Button>
        ) : null}
        <Text style={small}>
          O convite vale por 48 horas{expira ? ` (até ${expira})` : ''} e só pode ser usado uma vez, por este e-mail.
          Se você não esperava este convite, ignore esta mensagem.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Seu convite de acesso à Lardan',
  displayName: 'Convite de acesso',
  previewData: { nome: 'Maria', link: 'https://www.lardan.com.br/convite/exemplo', expira: '27/09 18:00' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Georgia, serif' }
const container = { padding: '32px 28px', maxWidth: '520px' }
const h1 = { fontSize: '24px', color: '#2b2320', margin: '0 0 20px' }
const text = { fontSize: '15px', lineHeight: '1.6', color: '#3d3431', fontFamily: 'Arial, sans-serif' }
const small = { fontSize: '12px', lineHeight: '1.5', color: '#7a6f6a', fontFamily: 'Arial, sans-serif', marginTop: '24px' }
const button = {
  backgroundColor: '#b08d57',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '999px',
  fontFamily: 'Arial, sans-serif',
  fontSize: '15px',
  textDecoration: 'none',
}
