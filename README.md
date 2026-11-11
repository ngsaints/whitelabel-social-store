<div align="center">

# ✳ White-label Social Store

### Sua marca. Sua loja. Sua margem.

Uma loja de serviços para redes sociais com visual leve, vidro translúcido e uma administração feita para simplificar sua operação.

**Português & English** · **Turso** · **Pix & Stripe** · **Login por e-mail**

[Conheça a plataforma](#a-experiência) · [Comece aqui](#comece-aqui) · [Configuração completa](docs/SETUP.md)

<br>

![Página inicial da plataforma, com identidade personalizável e catálogo por rede social](docs/images/storefront-preview.jpg)

</div>

## A experiência

Uma vitrine para Instagram, TikTok, YouTube e outros serviços do seu provedor. O cliente encontra o serviço, escolhe a quantidade e segue para o pagamento; você controla a marca, os preços e as integrações pelo painel.

| Para quem compra                             | Para quem administra                       |
| :------------------------------------------- | :----------------------------------------- |
| Catálogo com busca e filtros por rede        | Nome, logo, cor e frase da sua marca       |
| Interface responsiva em português e inglês   | Margem sobre o custo e simulação de preço  |
| Quantidade e preço antes do pagamento        | Câmbio manual e serviços ocultos           |
| Pix UvviPay ou cartão via Stripe             | Chaves dos provedores protegidas no painel |
| Consulta do último pedido no mesmo navegador | Pedidos recentes e status da operação      |

<details>
<summary><strong>Ver o print completo da plataforma</strong></summary>

<br>

![Loja completa com catálogo demonstrativo e identidade visual por rede social](docs/images/storefront.jpg)

</details>

> Os prints mostram o catálogo demonstrativo. Aura é a identidade de exemplo: cada instalação pode usar sua própria marca.

## Comece aqui

### 1. Conecte seu catálogo

[Crie sua conta](https://smmhype.com/ref/mhcpt) e pegue sua chave privada da API.

Depois, salve a chave em **Painel → Integrações → SMMhype**. O catálogo utiliza os serviços do tipo `Default` disponibilizados pelo provedor.

### 2. Prepare a instalação

Requer **Node.js 24+** e um banco **Turso**. A aplicação não exige instalação de dependências npm para executar.

```sh
git clone https://github.com/ngsaints/whitelabel-social-store.git
cd whitelabel-social-store
```

Copie `store/.env.example` para `store/.env`, gere os valores de instalação e preencha a conexão do Turso:

```sh
npm run keys
npm run db:init
npm run dev
```

Acesse **[localhost:4173/admin](http://localhost:4173/admin)** com seu e-mail e o `SETUP_TOKEN`. Configure o Resend para os próximos acessos por código enviado ao e-mail.

### 3. Deixe a loja com a sua cara

No painel, personalize **nome, logo, cor e frase**. Defina a conversão do custo para reais e seu percentual de acréscimo em **Catálogo e preços**.

```text
Preço de venda = custo do provedor × câmbio × (1 + acréscimo / 100)
```

Exemplo: custo convertido de **R$ 10,00**, com acréscimo de **50%**, resulta em **R$ 15,00**. As taxas do gateway devem ser consideradas na sua formação de preço.

### 4. Escolha como receber

| Integração  | Função                            | Configuração              |
| :---------- | :-------------------------------- | :------------------------ |
| **SMMhype** | Catálogo e envio de pedidos       | Painel → Integrações      |
| **Resend**  | Código de acesso por e-mail       | Painel → Integrações      |
| **UvviPay** | Checkout Pix                      | Painel → Pagamentos       |
| **Stripe**  | Checkout hospedado para cartão    | Painel → Pagamentos       |
| **Turso**   | Configurações, seleções e pedidos | Conexão inicial no `.env` |

Ative UvviPay, Stripe ou ambas. As chaves de pagamento e os webhooks são configurados pelo painel. Para registrar os webhooks, a loja precisa de uma **URL pública HTTPS** acessível pelos provedores.

**As cobranças desta versão são em BRL.** O idioma da interface não altera a moeda. Homologue as integrações no ambiente de testes antes de abrir vendas reais.

## Explore antes de configurar

**Loja demonstrativa** — abre sem chaves e sem banco:

```sh
npm run dev
```

Abra [localhost:4173](http://localhost:4173).

**Painel demonstrativo** — dados temporários, sem chamadas aos provedores:

```sh
npm run preview:admin
```

Abra [localhost:4174/admin](http://localhost:4174/admin). Essa prévia funciona somente no computador local e não processa pagamentos.

## Construída para você operar

- **Identidade própria:** logo, nome, cores e textos configuráveis.
- **Segredos protegidos:** chaves criptografadas no Turso com AES-GCM e campos mascarados no painel.
- **Confirmação no servidor:** o retorno do checkout não aprova o pedido; o pagamento é conferido com o gateway.
- **Proteção contra duplicidade:** cobranças usam idempotência e a entrega tem controle de processamento.
- **Hospedagem independente:** servidor Node, Docker ou módulo Fetch para Cloudflare Workers.

Os acessos OTP desta versão são para o administrador. Assinaturas, conta de cliente com OTP e reembolso pelo painel ainda não estão disponíveis. Veja os detalhes operacionais no [guia de configuração](docs/SETUP.md#escopo-e-operação).

## Desenvolvimento

```sh
npm test
npm run build
npm --prefix store run validate
```

Os testes simulam as integrações externas e verificam autenticação, precificação, migração do banco e confirmação de pagamentos. Não substituem homologação com as contas dos provedores.

**Instalação, Docker, atualização do banco e operação:** [docs/SETUP.md](docs/SETUP.md).

---

<div align="center">

**White-label Social Store** · Personalize. Configure. Opere.

Licença [MIT](LICENSE).

</div>
