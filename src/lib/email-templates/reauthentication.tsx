import * as React from 'react'
import { Codigo, LardanLayout, Paragrafo } from './_layout'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <LardanLayout
    preview="Seu código de verificação da Lardan"
    selo="Segurança"
    titulo="Seu código de verificação"
    rodape="Este código expira em pouco tempo. Se você não pediu, ignore esta mensagem."
  >
    <Paragrafo>Use o código abaixo para confirmar sua identidade:</Paragrafo>
    <Codigo>{token}</Codigo>
  </LardanLayout>
)

export default ReauthenticationEmail
