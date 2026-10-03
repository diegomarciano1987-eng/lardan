import React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { LardanLayout, Paragrafo } from './_layout'

interface Props {
  nome?: string
  codigo?: string
  loja?: string
}

const Email = ({ nome, codigo, loja }: Props) => (
  <LardanLayout
    preview={`Seu código para entrar no PDV: ${codigo ?? ''}`}
    selo="Código de acesso"
    titulo={nome ? `${nome}, use este código para entrar no PDV` : 'Use este código para entrar no PDV'}
    rodape="O código vale por 10 minutos e só pode ser usado uma vez. Se não foi você que tentou entrar, avise a gestão da loja."
  >
    <Paragrafo>{loja ? `Entrada pedida na loja ${loja}.` : 'Entrada pedida no PDV da loja.'} Digite o código abaixo na tela do aparelho:</Paragrafo>
    <Text style={{ fontSize: '34px', letterSpacing: '10px', fontWeight: 700, textAlign: 'center', color: '#1c1917', margin: '24px 0' }}>{codigo ?? '------'}</Text>
  </LardanLayout>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `${d['codigo'] ?? 'Seu código'} é o seu código do PDV Lardan`,
  displayName: 'Código de entrada do PDV',
  previewData: { nome: 'Maria', codigo: '482913', loja: 'LOJA ETINERANTE nº 12026' },
} satisfies TemplateEntry
