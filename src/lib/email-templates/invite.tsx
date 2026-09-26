import * as React from 'react'
import { LardanLayout, Paragrafo } from './_layout'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <LardanLayout
    preview="Você foi convidada(o) para fazer parte da Lardan"
    selo="Convite exclusivo"
    titulo="Você foi convidada(o) para brilhar com a Lardan"
    botao={{ texto: 'Aceitar convite', link: confirmationUrl }}
    rodape="Se você não esperava este convite, ignore esta mensagem."
  >
    <Paragrafo>É uma alegria ter você com a gente. Toque no botão abaixo para aceitar o convite e criar sua conta.</Paragrafo>
  </LardanLayout>
)

export default InviteEmail
