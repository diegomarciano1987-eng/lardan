import * as React from 'react'
import { LardanLayout, Paragrafo } from './_layout'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <LardanLayout
    preview="Crie uma nova senha para sua conta Lardan"
    selo="Segurança"
    titulo="Vamos criar uma nova senha"
    botao={{ texto: 'Redefinir minha senha', link: confirmationUrl }}
    rodape="Se você não pediu a troca de senha, ignore esta mensagem — sua senha atual continua valendo."
  >
    <Paragrafo>Recebemos um pedido para redefinir a senha da sua conta na Lardan.</Paragrafo>
    <Paragrafo>Toque no botão abaixo para escolher uma nova senha.</Paragrafo>
  </LardanLayout>
)

export default RecoveryEmail
