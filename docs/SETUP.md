# Guia de configuração e operação

[← Voltar à apresentação](../README.md)

Loja responsiva em português e inglês, branca, com glassmorphism e destaques por rede social. Código aberto sob licença MIT. Aura é uma marca de exemplo; cada instalação tem sua própria marca, dados e credenciais. O seletor de idioma está disponível na loja e no painel; nomes personalizados de serviços e textos da marca mantêm o conteúdo definido pelo lojista/provedor.

## Recursos

- Catálogo SMMhype com busca e filtros por rede. Serviços do tipo `Default`.
- Painel em `/admin`: nome, envio/remoção de logo PNG/JPG/WebP, cor, frase, margem, câmbio manual e serviços ocultos. Simulação de preço atualizada ao alterar margem e câmbio.
- Chaves SMMhype, Resend, UvviPay e Stripe configuradas no painel, criptografadas com AES-GCM no Turso. Campos vazios preservam o segredo; a API retorna apenas se está configurado.
- Primeiro acesso por token de instalação; depois, login administrador por código de seis dígitos enviado pelo Resend, válido por dez minutos, com limite de cinco tentativas e intervalo de reenvio.
- Turso para configurações, desafios OTP, seleções e pedidos. Consultas parametrizadas.
- Checkout Pix UvviPay. Valor calculado no servidor, idempotência na cobrança, webhook HMAC e consulta autenticada do pagamento antes do envio à SMMhype.
- Stripe Checkout hospedado para cartão, opcional e independente do Pix. O administrador pode oferecer um gateway ou ambos. A loja cobra em BRL nesta versão; idioma inglês não converte a moeda. CPF é exigido apenas no checkout Pix. Dados de cartão são coletados pela Stripe.
- Se o envio à SMMhype ficar incerto, o pedido exige conferência manual. Não há reenvio automático que possa duplicá-lo.

## Instalação rápida

Para explorar somente o visual da loja: `npm run dev`. Sem banco/chaves, ela abre com catálogo demonstrativo. Para explorar o painel sem configurar serviços: `npm run preview:admin`, depois abra `http://localhost:4174/admin`. Essa prévia é restrita ao computador local, usa dados temporários em memória e bloqueia chamadas externas; não é a configuração de produção.

Requer **Node.js 24+** e um banco Turso. Sem dependências npm para instalar.

```powershell
Copy-Item store/.env.example store/.env
npm run keys
```

Preencha `store/.env` com a URL/token do Turso e os dois valores distintos gerados. O arquivo é ignorado pelo Git. Guarde `APP_ENCRYPTION_KEY`: sem ela, as configurações e os dados de comprador criptografados ficam inacessíveis.

```powershell
npm run db:init
npm run dev
```

Abra `http://localhost:4173/admin`. Informe seu e-mail administrador e o `SETUP_TOKEN`. Depois da instalação, o token não permite novo acesso. No painel, configure Resend e um remetente com domínio verificado; valide o login por e-mail antes de encerrar a primeira sessão.

## Configurar para vender

1. Em **Sua marca**, defina nome, cor e frase.
2. Em **Integrações**, salve SMMhype, Resend e remetente.
3. Em **Catálogo e preços**, confirme a moeda da conta do provedor e a conversão manual para reais. A fórmula é custo × câmbio × (1 + acréscimo / 100). Os valores do catálogo são por mil unidades. A loja arredonda para centavos.
4. Em **Pagamentos**, ative UvviPay, Stripe ou ambas. Para UvviPay, configure Client ID, Client Secret e ambiente; comece por staging. Para Stripe, salve a chave secreta `sk_test_...` para teste ou `sk_live_...` para produção.
5. Hospede com URL pública HTTPS acessível pelos provedores, defina `APP_URL` e salve. Use o botão de registro do webhook do gateway escolhido. Para Stripe, o painel cria o endpoint em `/api/webhooks/stripe` e guarda o segredo automaticamente. A chave precisa permitir gerenciar endpoints de webhook; alternativamente, configure o endpoint na Stripe e cole seu segredo `whsec_...` no painel. Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` e `charge.dispute.closed`. A API usa a versão `2024-06-20`.
6. Habilite vendas e homologue o fluxo completo no ambiente do gateway. O botão de retorno da Stripe não aprova o pedido: o servidor consulta a sessão e confere ID, referência, valor e moeda antes de liberar o serviço. Não há chaves de teste ou de produção incluídas neste repositório.

As credenciais financeiras ficam bloqueadas para alteração quando já existem pedidos do respectivo gateway, para preservar consulta e reconciliação. É possível adicionar Stripe a uma instalação com pedidos Pix. A chave SMMhype é compartilhada pela entrega e fica bloqueada quando há pedidos. Trocas de conta exigem migração assistida. Desativar um gateway impede novas compras nele, mantendo a confirmação dos pedidos já criados.

### Atualizar uma instalação existente

Execute `npm run db:init` com as variáveis do mesmo banco antes de iniciar o código atualizado. A migração adiciona as colunas do gateway e do checkout sem apagar os pedidos; os pedidos anteriores permanecem vinculados à UvviPay. A operação pode ser repetida.

## Hospedagem

O projeto é independente de uma plataforma de hospedagem. Para Node/Docker, configure as variáveis pelo provedor, `HOST=0.0.0.0` e `APP_URL=https://sua-loja.com`, com HTTPS no proxy. O Dockerfile usa porta 4173. Rode `npm run db:init` com as mesmas variáveis antes de iniciar.

A loja limita tentativas por IP no checkout, no login do admin e na sincronização da seleção. No Cloudflare Workers o IP vem do próprio Cloudflare. No servidor Node, o IP é o da conexão; atrás de um proxy reverso (nginx, Caddy, load balancer), defina `TRUST_PROXY=1` para usar o último endereço de `X-Forwarded-For`. Sem isso, todos os clientes compartilham o IP do proxy e o limite é atingido rápido.

```sh
docker build -t social-store .
docker run --env-file store/.env -e HOST=0.0.0.0 -p 4173:4173 social-store
```

`npm run build` também gera `store/dist/server/index.js`, um módulo Fetch compatível com Cloudflare Workers. A pasta local `.openai` é ignorada e corresponde somente à prévia de desenvolvimento; não é necessária para executar ou publicar uma instalação própria.

## Verificação

```sh
npm test
npm run build
npm --prefix store run validate
```

Os testes usam SQLite em memória para validar o SQL e simulam HTTP de Turso, SMMhype, Resend, UvviPay e Stripe. Cobrem instalação única, segredos mascarados, OTP de uso único, precificação no servidor, isolamento de pedidos, webhook assinado, repetição/concor­rência de notificações, divergência de valor, estorno Stripe, falha ambígua de envio e migração de pedidos Pix. Não substituem homologação com contas reais.

## Escopo e operação

O checkout implementa **Pix avulso pela UvviPay e cartão pela Stripe**. Assinatura, reembolso pelo painel, conta de cliente com OTP e recuperação administrativa de acesso ainda não estão implementados. O OTP desta versão é para o administrador. O cliente consulta o último pedido pelo mesmo navegador; não há envio de link de rastreio por e-mail. Stripe pode atender cartões de outros países conforme a habilitação da conta e as regras do provedor; esta integração não adiciona preços em USD/EUR.

O painel apresenta até 100 pedidos recentes e não simula faturamento. Pedidos `fulfillment_unknown`/`submitting` precisam de conferência no provedor antes de qualquer reenvio manual. Estornos/contestações atualizam o pedido, mas não cancelam automaticamente uma entrega já enviada. Notificações perdidas são reconciliadas ao consultar o pedido; não há worker periódico nesta versão. O lojista deve acompanhar também o painel financeiro.

A seleção contém links públicos salvos no navegador/Turso e não deve receber segredos. Dados de comprador são criptografados; estabeleça políticas de privacidade, retenção e suporte adequadas à sua operação. Não há garantia de alcance, vendas ou engajamento real. A loja não solicita senhas de redes sociais.

## Referências dos provedores

- [SMMhype: criar conta](https://smmhype.com/ref/mhcpt) · [documentação da API](https://smmhype.com/api)
- [Turso HTTP](https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md)
- [Resend: envio e idempotência](https://resend.com/blog/engineering-idempotency-keys)
- [UvviPay: pagamentos](https://developers.uvvipay.com.br/api-reference/payments/create)
- [UvviPay: webhooks](https://developers.uvvipay.com.br/webhooks)
- [Stripe: Checkout](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe: webhooks](https://docs.stripe.com/events/manage-webhook-endpoints)
