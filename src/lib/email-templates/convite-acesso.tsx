import React from 'react'
import type { TemplateEntry } from './registry'
import { LardanLayout, Paragrafo } from './_layout'

interface Props {
  nome?: string
  link?: string
  expira?: string
}

const Email = ({ nome, link, expira }: Props) => (
  <LardanLayout
    preview="Você foi convidada(o) para fazer parte da Lardan"
    selo="Convite exclusivo"
    titulo={nome ? `${nome}, você foi convidada(o) para brilhar com a Lardan` : 'Você foi convidada(o) para brilhar com a Lardan'}
    botao={link ? { texto: 'Aceitar convite', link } : undefined}
    rodape={`Este convite é pessoal, vale por 48 horas${expira ? ` (até ${expira})` : ''} e só pode ser usado uma vez, com este e-mail. Se você não esperava este convite, ignore esta mensagem.`}
  >
    <Paragrafo>
      É uma alegria ter você com a gente. Preparamos o seu acesso ao sistema da Lardan — o lugar onde
      acompanhamos cada peça, cada conquista e cada história que faz o nosso brilho permanecer.
    </Paragrafo>
    <Paragrafo>Toque no botão abaixo para criar sua senha e começar.</Paragrafo>
  </LardanLayout>
)

export const template = {
  component: Email,
  subject: 'Seu convite exclusivo para a Lardan ✨',
  displayName: 'Convite de acesso',
  previewData: { nome: 'Maria', link: 'https://www.lardan.com.br/convite/exemplo', expira: '27/09 18:00' },
} satisfies TemplateEntry
