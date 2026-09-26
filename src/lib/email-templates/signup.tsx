import * as React from 'react'
import { LardanLayout, Paragrafo } from './_layout'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ recipient, confirmationUrl }: SignupEmailProps) => (
  <LardanLayout
    preview="Confirme seu e-mail para ativar seu acesso à Lardan"
    selo="Boas-vindas"
    titulo="Falta só um passo"
    botao={{ texto: 'Confirmar meu e-mail', link: confirmationUrl }}
    rodape="Se você não criou uma conta na Lardan, ignore esta mensagem."
  >
    <Paragrafo>Recebemos o seu cadastro com o e-mail {recipient}.</Paragrafo>
    <Paragrafo>Confirme que este e-mail é seu para concluir o acesso ao sistema da Lardan.</Paragrafo>
  </LardanLayout>
)

export default SignupEmail
