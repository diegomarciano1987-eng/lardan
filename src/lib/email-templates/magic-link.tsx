import * as React from 'react'
import { LardanLayout, Paragrafo } from './_layout'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <LardanLayout
    preview="Seu link de acesso à Lardan"
    selo="Acesso"
    titulo="Seu link de entrada"
    botao={{ texto: 'Entrar na Lardan', link: confirmationUrl }}
    rodape="Este link expira em pouco tempo. Se você não pediu para entrar, ignore esta mensagem."
  >
    <Paragrafo>Toque no botão abaixo para entrar no sistema da Lardan.</Paragrafo>
  </LardanLayout>
)

export default MagicLinkEmail
