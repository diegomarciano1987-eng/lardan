import * as React from 'react'
import { LardanLayout, Paragrafo } from './_layout'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ oldEmail, email, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <LardanLayout
    preview="Confirme a troca do seu e-mail na Lardan"
    selo="Segurança"
    titulo="Confirme seu novo e-mail"
    botao={{ texto: 'Confirmar troca', link: confirmationUrl }}
    rodape="Se você não pediu esta troca, proteja sua conta imediatamente redefinindo sua senha."
  >
    <Paragrafo>
      Recebemos um pedido para trocar o e-mail da sua conta de {oldEmail || email} para {newEmail}.
    </Paragrafo>
  </LardanLayout>
)

export default EmailChangeEmail
